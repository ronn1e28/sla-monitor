import { createClient } from "npm:@supabase/supabase-js@2";
import { cleanCsv } from "./clean.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });

const BATCH = 1000;
const MAX_BYTES = 10 * 1024 * 1024;
const MAX_REJECTED_STORED = 5000; // counts are always complete; raw rows are capped

const errMsg = (e: unknown) =>
  e instanceof Error ? e.message : (e as { message?: string })?.message ?? String(e);

function* chunks<T>(arr: T[], size: number) {
  for (let i = 0; i < arr.length; i += size) yield arr.slice(i, i + size);
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ ok: false, error: "Use POST" }, 405);

  try {
    // 1. Read the uploaded file
    const form = await req.formData();
    const file = form.get("file");
    if (!(file instanceof File)) {
      return json({ ok: false, error: "Send the CSV as form field 'file'" }, 400);
    }
    if (file.size > MAX_BYTES) {
      return json({ ok: false, error: "File too large (max 10 MB)" }, 413);
    }

    // 2. Clean it (pure function from clean.ts)
    let result;
    try {
      result = cleanCsv(await file.text());
    } catch (e) {
      return json({ ok: false, error: errMsg(e) }, 400);
    }
    const { rows, rejected, report } = result;

    // 3. DB client: the secret key never leaves the function
    const secretKeys = JSON.parse(Deno.env.get("SUPABASE_SECRET_KEYS")!);
    const supabase = createClient(Deno.env.get("SUPABASE_URL")!, secretKeys.default);

    // 4. Record the upload
    const { data: upload, error: upErr } = await supabase
      .from("uploads")
      .insert({ filename: file.name })
      .select()
      .single();
    if (upErr) throw upErr;

        // 5. Merge into checks with the failure-wins rule (SQL function)
    const merge = { new_slots: 0, overlapping_slots: 0, turned_down: 0, kept_existing_failure: 0 };
    for (const batch of chunks(rows, BATCH)) {
      const { data, error } = await supabase.rpc("upsert_checks", {
        p_rows: batch,
        p_upload_id: upload.id,
      });
      if (error) throw error;
      for (const k of Object.keys(merge) as (keyof typeof merge)[]) merge[k] += data[k];
    }

    // 6. Keep the rejected rows so findings are auditable
    const rejectedToStore = rejected
      .slice(0, MAX_REJECTED_STORED)
      .map((r) => ({ upload_id: upload.id, raw: r.raw, reason: r.reason }));
    for (const batch of chunks(rejectedToStore, BATCH)) {
      const { error } = await supabase.from("rejected_rows").insert(batch);
      if (error) throw error;
    }

    // 7. Finalize the upload record
    const { error: finErr } = await supabase
      .from("uploads")
      .update({
        rows_total: report.total,
        rows_accepted: report.accepted,
        rows_rejected: report.rejected,
        report: { ...report.counts, ...merge },
      })
      .eq("id", upload.id);
    if (finErr) throw finErr;

    return json({ ok: true, upload_id: upload.id, report, merge });
  } catch (e) {
    return json({ ok: false, error: errMsg(e) }, 500);
  }
});