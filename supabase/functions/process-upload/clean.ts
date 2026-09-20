// Pure module: no Deno/Node APIs, so it runs in the Edge Function and locally.

export interface CleanRow {
  service_id: string;
  service_name: string;
  ts: string; // ISO 8601, UTC
  status_code: number;
  latency_ms: number | null;
  agent: string | null;
  region: string | null;
}

export interface RejectedRow {
  raw: Record<string, string>;
  reason: string;
}

export interface CleanResult {
  rows: CleanRow[];
  rejected: RejectedRow[];
  report: {
    total: number;
    accepted: number;
    rejected: number;
    counts: Record<string, number>;
  };
}

const REQUIRED = ["timestamp", "service_id", "service_name", "status_code"];

/** Minimal CSV parser: handles quotes, CRLF, BOM and blank lines. */
export function parseCsv(text: string): string[][] {
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;

  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; }
        else inQuotes = false;
      } else field += c;
    } else if (c === '"') {
      inQuotes = true;
    } else if (c === ",") {
      row.push(field);
      field = "";
    } else if (c === "\n" || c === "\r") {
      if (c === "\r" && text[i + 1] === "\n") i++;
      row.push(field);
      field = "";
      if (row.some((f) => f !== "")) rows.push(row);
      row = [];
    } else field += c;
  }
  if (field !== "" || row.length) {
    row.push(field);
    if (row.some((f) => f !== "")) rows.push(row);
  }
  return rows;
}

type TsKind = "iso" | "epoch" | "offset";

function parseTimestamp(raw: string): { iso: string; kind: TsKind } | null {
  const s = raw.trim();

  // Unix epoch: 9-10 digits = seconds, 13 digits = milliseconds
  if (/^\d{9,13}$/.test(s)) {
    const ms = s.length >= 13 ? Number(s) : Number(s) * 1000;
    const d = new Date(ms);
    return isNaN(d.getTime()) ? null : { iso: d.toISOString(), kind: "epoch" };
  }

  // ISO 8601 with an explicit timezone (Z or +hh:mm). We never guess local time.
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:?\d{2})$/.test(s)) {
    return null;
  }
  const d = new Date(s);
  if (isNaN(d.getTime())) return null;
  return { iso: d.toISOString(), kind: s.endsWith("Z") ? "iso" : "offset" };
}

function parseStatus(raw: string): number | null {
  if (!/^\d{3}$/.test(raw)) return null;
  const n = Number(raw);
  return n >= 100 && n <= 599 ? n : null; // e.g. 999 is not a real HTTP status
}

function parseLatency(
  raw: string,
  unit: string,
): { ms: number | null; note?: string } {
  if (raw === "") return { ms: null, note: "missing_latency" };
  const n = Number(raw);
  if (!Number.isFinite(n)) return { ms: null, note: "non_numeric_latency" };
  if (n < 0) return { ms: null, note: "negative_latency_nulled" };

  const u = unit.trim().toLowerCase();
  if (u === "ms") return { ms: n };
  if (u === "s") {
    // round to 3 decimals to avoid float noise like 486.00000000000006
    return { ms: Math.round(n * 1000 * 1000) / 1000, note: "latency_seconds_converted" };
  }
  return { ms: null, note: "unknown_latency_unit" };
}

export function cleanCsv(text: string): CleanResult {
  const table = parseCsv(text);
  if (table.length === 0) throw new Error("File is empty");

  const header = table[0].map((h) => h.trim().toLowerCase());
  const missing = REQUIRED.filter((c) => !header.includes(c));
  if (missing.length) throw new Error(`Missing required columns: ${missing.join(", ")}`);

  const counts: Record<string, number> = {};
  const bump = (k: string) => { counts[k] = (counts[k] ?? 0) + 1; };

  const rejected: RejectedRow[] = [];
  const reject = (raw: Record<string, string>, reason: string) => {
    rejected.push({ raw, reason });
    bump(reason);
  };

  const kept = new Map<string, { row: CleanRow; raw: Record<string, string> }>();

  for (const cells of table.slice(1)) {
    const raw: Record<string, string> = {};
    header.forEach((h, i) => (raw[h] = (cells[i] ?? "").trim()));

    // Hard failures: the row can't be trusted, so reject it and record why
    if (!raw.service_id || !raw.service_name) { reject(raw, "missing_service"); continue; }
    const ts = parseTimestamp(raw.timestamp);
    if (!ts) { reject(raw, "invalid_timestamp"); continue; }
    const status = parseStatus(raw.status_code);
    if (status === null) { reject(raw, "invalid_status_code"); continue; }

    // Soft fixes: keep the row, repair or null the bad field, and count it
    if (ts.kind === "epoch") bump("timestamp_epoch_converted");
    if (ts.kind === "offset") bump("timestamp_offset_normalized");
    const lat = parseLatency(raw.latency ?? "", raw.latency_unit ?? "");
    if (lat.note) bump(lat.note);

    const row: CleanRow = {
      service_id: raw.service_id,
      service_name: raw.service_name,
      ts: ts.iso,
      status_code: status,
      latency_ms: lat.ms,
      agent: raw.agent || null,
      region: raw.region || null,
    };

    // Dedupe on (service, timestamp): several agents report the same slot
    const key = `${row.service_id}|${row.ts}`;
    const prev = kept.get(key);
    if (!prev) { kept.set(key, { row, raw }); continue; }

    if (prev.row.status_code === row.status_code) {
      bump("duplicate_removed");
      // Same verdict: keep whichever copy has a usable latency
      if (prev.row.latency_ms === null && row.latency_ms !== null) {
        kept.set(key, { row, raw });
      }
      continue;
    }

    // Agents disagree: a failure reported by any agent wins
    const prevDown = prev.row.status_code >= 500;
    const curDown = row.status_code >= 500;
    if (curDown && !prevDown) {
      reject(prev.raw, "duplicate_conflict");
      kept.set(key, { row, raw });
    } else {
      reject(raw, "duplicate_conflict");
    }
  }

  const rows = [...kept.values()]
    .map((k) => k.row)
    .sort((a, b) =>
      a.ts < b.ts ? -1 : a.ts > b.ts ? 1 : a.service_id.localeCompare(b.service_id)
    );

  return {
    rows,
    rejected,
    report: {
      total: table.length - 1,
      accepted: rows.length,
      rejected: rejected.length,
      counts,
    },
  };
}