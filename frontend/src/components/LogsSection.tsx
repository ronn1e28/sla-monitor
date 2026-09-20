import { useEffect, useMemo, useState } from "react";
import { supabase } from "../lib/supabase";
import type { CheckRow } from "../lib/types";

const PAGE_SIZE = 100;
const dayStart = (d: string) => `${d}T00:00:00Z`;
const nextDay = (d: string) => new Date(Date.parse(dayStart(d)) + 86_400_000).toISOString();

const fmtDay = (d: string) =>
  new Date(`${d}T00:00:00Z`).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  });

// ["2025-04-03", "2025-04-04", "2025-04-06"] -> [["2025-04-03","2025-04-04"], ["2025-04-06","2025-04-06"]]
function toRanges(days: string[]): [string, string][] {
  const out: [string, string][] = [];
  for (const d of days) {
    const last = out[out.length - 1];
    const gap = last ? Date.parse(dayStart(d)) - Date.parse(dayStart(last[1])) : 0;
    if (last && gap === 86_400_000) last[1] = d;
    else out.push([d, d]);
  }
  return out;
}

type Result = { key: string; rows: CheckRow[]; total: number; error: string | null };

export default function LogsSection() {
  const [mode, setMode] = useState<"single" | "range">("single");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [failuresOnly, setFailuresOnly] = useState(false);
  const [page, setPage] = useState(0);
  const [result, setResult] = useState<Result | null>(null);
  const [days, setDays] = useState<string[]>([]);

  // Which dates have data (drives the picker limits and the hint line)
  useEffect(() => {
    supabase
      .from("available_dates")
      .select("day")
      .order("day")
      .then(({ data }) => setDays((data ?? []).map((r) => r.day as string)));
  }, []);

  const ranges = useMemo(() => toRanges(days), [days]);
  const minDay = days[0];
  const maxDay = days[days.length - 1];

  const key = `${mode}|${from}|${to}|${failuresOnly}|${page}`;
  const badRange = mode === "range" && !!from && !!to && from > to;
  const loading = result?.key !== key;

  useEffect(() => {
    if (badRange) return;
    let cancelled = false;

    const last = mode === "single" ? from : to;
    let q = supabase
      .from("checks")
      .select("service_id, service_name, ts, status_code, latency_ms, agent, region", {
        count: "exact",
      });
    if (from) q = q.gte("ts", dayStart(from));
    if (last) q = q.lt("ts", nextDay(last));
    if (failuresOnly) q = q.gte("status_code", 500);

    const start = page * PAGE_SIZE;
    q.order("ts", { ascending: false })
      .order("service_id")
      .range(start, start + PAGE_SIZE - 1)
      .then(({ data, count, error }) => {
        if (cancelled) return;
        setResult({
          key,
          rows: (data ?? []) as CheckRow[],
          total: count ?? 0,
          error: error?.message ?? null,
        });
      });

    return () => {
      cancelled = true;
    };
  }, [key, mode, from, to, failuresOnly, page, badRange]);

  const total = result?.total ?? 0;
  const start = page * PAGE_SIZE;
  const lastPage = Math.max(0, Math.ceil(total / PAGE_SIZE) - 1);

  const clear = () => {
    setFrom("");
    setTo("");
    setFailuresOnly(false);
    setPage(0);
  };

  return (
    <section className="panel">
      <h2 style={{ marginTop: 0 }}>Check logs</h2>

      <div className="filters">
        <label>
          <input
            type="radio"
            checked={mode === "single"}
            onChange={() => {
              setMode("single");
              setTo("");
              setPage(0);
            }}
          />{" "}
          Single date
        </label>
        <label>
          <input
            type="radio"
            checked={mode === "range"}
            onChange={() => {
              setMode("range");
              setPage(0);
            }}
          />{" "}
          Date range
        </label>
        <label>
          {mode === "single" ? "Date" : "From"}{" "}
          <input
            type="date"
            min={minDay}
            max={maxDay}
            value={from}
            onChange={(e) => {
              setFrom(e.target.value);
              setPage(0);
            }}
          />
        </label>
        {mode === "range" && (
          <label>
            To{" "}
            <input
              type="date"
              min={minDay}
              max={maxDay}
              value={to}
              onChange={(e) => {
                setTo(e.target.value);
                setPage(0);
              }}
            />
          </label>
        )}
        <label>
          <input
            type="checkbox"
            checked={failuresOnly}
            onChange={(e) => {
              setFailuresOnly(e.target.checked);
              setPage(0);
            }}
          />{" "}
          Failures only
        </label>
        <button onClick={clear}>Clear</button>
      </div>

      {ranges.length > 0 && (
        <p className="hint">
          Data available for:{" "}
          {ranges
            .map(([a, b]) => (a === b ? fmtDay(a) : `${fmtDay(a)} – ${fmtDay(b)}`))
            .join(" · ")}
        </p>
      )}

      {badRange && <p role="alert">The start date is after the end date.</p>}
      {result?.error && <p role="alert">Could not load logs: {result.error}</p>}

      {!badRange && result && (
        <div className={loading ? "dim" : ""}>
          <table className="table">
            <thead>
              <tr>
                <th>Time (UTC)</th>
                <th>Service</th>
                <th>Status</th>
                <th>Latency</th>
                <th>Agent</th>
                <th>Region</th>
              </tr>
            </thead>
            <tbody>
              {result.rows.map((r) => (
                <tr key={`${r.service_id}-${r.ts}`}>
                  <td>{r.ts.replace("T", " ").slice(0, 16)}</td>
                  <td>{r.service_id}</td>
                  <td>
                    <span className={`badge ${r.status_code >= 500 ? "bad" : "good"}`}>
                      {r.status_code}
                    </span>
                  </td>
                  <td>{r.latency_ms == null ? "—" : `${Math.round(Number(r.latency_ms))} ms`}</td>
                  <td>{r.agent ?? "—"}</td>
                  <td>{r.region ?? "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {result.rows.length === 0 && <p>No checks match these filters.</p>}

          <div className="pager">
            <button disabled={page === 0} onClick={() => setPage((p) => p - 1)}>
              ← Prev
            </button>
            <span>
              {total ? start + 1 : 0}–{Math.min(start + PAGE_SIZE, total)} of{" "}
              {total.toLocaleString()}
            </span>
            <button disabled={page >= lastPage} onClick={() => setPage((p) => p + 1)}>
              Next →
            </button>
          </div>
        </div>
      )}
    </section>
  );
}