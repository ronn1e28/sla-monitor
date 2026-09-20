import { readFileSync } from "node:fs";
import { cleanCsv } from "../supabase/functions/process-upload/clean.ts";

const [a, b] = process.argv.slice(2);
const load = (f: string) =>
  new Map(
    cleanCsv(readFileSync(f, "utf8")).rows.map((r) => [`${r.service_id}|${r.ts}`, r]),
  );

const A = load(a);
const B = load(b);
let shared = 0, sameStatus = 0, sameLatency = 0;
const diffs: unknown[] = [];

for (const [k, ra] of A) {
  const rb = B.get(k);
  if (!rb) continue;
  shared++;
  if (ra.status_code === rb.status_code) sameStatus++;
  else if (diffs.length < 5) diffs.push({ slot: k, a: ra.status_code, b: rb.status_code });
  if (ra.latency_ms === rb.latency_ms) sameLatency++;
}
console.log({ shared, sameStatus, sameLatency, sampleStatusDiffs: diffs });