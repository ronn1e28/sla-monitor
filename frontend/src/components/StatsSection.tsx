import { useEffect, useMemo, useState } from "react";
import { supabase } from "../lib/supabase";
import type { IncidentRow, MonthlyRow, UploadRow } from "../lib/types";

const TARGET = 99.9;
const MIN_COVERAGE_FOR_VERDICT = 50;

const monthLabel = (m: string) =>
  new Date(`${m}T00:00:00Z`).toLocaleDateString("en-GB", {
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  });

const fmtDuration = (min: number) => {
  const h = Math.floor(min / 60);
  return h ? `${h}h ${min % 60}m` : `${min}m`;
};

const fmtUtc = (iso: string) =>
  `${new Date(iso).toISOString().slice(0, 16).replace("T", " ")} UTC`;

function verdict(r: MonthlyRow) {
  if (r.coverage_pct < MIN_COVERAGE_FOR_VERDICT) {
    return { label: "Insufficient data", cls: "muted" };
  }
  return r.breached
    ? { label: "SLA breached", cls: "bad" }
    : { label: "SLA met", cls: "good" };
}

export default function StatsSection() {
  const [open, setOpen] = useState(true);
  const [monthly, setMonthly] = useState<MonthlyRow[]>([]);
  const [incidents, setIncidents] = useState<IncidentRow[]>([]);
  const [upload, setUpload] = useState<UploadRow | null>(null);
  const [month, setMonth] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      const [m, i, u] = await Promise.all([
        supabase.from("monthly_availability").select("*").order("month").order("service_id"),
        supabase
          .from("incidents")
          .select("*")
          .eq("is_sustained", true)
          .order("started_at", { ascending: false }),
        supabase
          .from("uploads")
          .select("*")
          .order("uploaded_at", { ascending: false })
          .limit(1)
          .maybeSingle(),
      ]);

      const err = m.error ?? i.error ?? u.error;
      if (err) {
        setError(err.message);
        setLoading(false);
        return;
      }

      const rows = (m.data ?? []) as MonthlyRow[];
      setMonthly(rows);
      setIncidents((i.data ?? []) as IncidentRow[]);
      setUpload((u.data ?? null) as UploadRow | null);

      const best = rows.reduce<MonthlyRow | null>(
        (a, r) => (!a || r.coverage_pct > a.coverage_pct ? r : a),
        null,
      );
      setMonth(best?.month ?? "");
      setLoading(false);
    })();
  }, []);

  const months = useMemo(() => [...new Set(monthly.map((r) => r.month))], [monthly]);
  const rows = monthly.filter((r) => r.month === month);
  const monthIncidents = incidents.filter((i) => i.started_at.startsWith(month.slice(0, 7)));

  return (
    <section className="panel">
      <button
        className="section-toggle"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
      >
        <span className="toggle-icon" style={{ transform: open ? "rotate(90deg)" : "rotate(0deg)", display: "inline-block" }}>▶</span>
        Service health
      </button>

      {open && (
        <div className="stack">
          {loading && <p style={{ margin: 0, color: "var(--text-muted)", fontSize: "0.9rem" }}>Loading…</p>}
          {error && <p role="alert">Could not load stats: {error}</p>}
          {!loading && !error && monthly.length === 0 && (
            <div className="empty-state">No data yet. Upload a CSV to get started.</div>
          )}

          {monthly.length > 0 && (
            <>
              <div className="section-label">
                <label htmlFor="month-select">Month</label>
                <select
                  id="month-select"
                  value={month}
                  onChange={(e) => setMonth(e.target.value)}
                >
                  {months.map((m) => (
                    <option key={m} value={m}>
                      {monthLabel(m)}
                    </option>
                  ))}
                </select>
              </div>

              <div className="cards">
                {rows.map((r) => {
                  const v = verdict(r);
                  const allowed = (r.total_checks * 15 * (100 - TARGET)) / 100;
                  const count = monthIncidents.filter((i) => i.service_id === r.service_id).length;
                  const bigCls = v.cls === "good" ? "big good-val" : v.cls === "bad" ? "big bad-val" : "big";
                  return (
                    <article className={`card card--${v.cls}`} key={r.service_id}>
                      <h3>{r.service_name}</h3>
                      <div className={bigCls}>{r.availability_pct.toFixed(3)}%</div>
                      <span className={`badge ${v.cls}`}>{v.label}</span>
                      <div className="card-stats">
                        <p>
                          Downtime: <strong style={{ color: "var(--text-secondary)" }}>{r.downtime_minutes} min</strong>
                          &ensp;·&ensp;allowed {allowed.toFixed(0)} min
                        </p>
                        <p>Incidents: <strong style={{ color: "var(--text-secondary)" }}>{count}</strong></p>
                        <p style={{ color: r.coverage_pct < MIN_COVERAGE_FOR_VERDICT ? "#f87171" : undefined }}>
                          Coverage: {r.coverage_pct}%
                        </p>
                      </div>
                    </article>
                  );
                })}
              </div>

              <div>
                <h3 className="subsection-heading">
                  Sustained incidents — {month && monthLabel(month)}
                </h3>
                {monthIncidents.length === 0 ? (
                  <p style={{ margin: 0, color: "var(--text-muted)", fontSize: "0.875rem" }}>
                    No sustained incidents this month.
                  </p>
                ) : (
                  <table className="table">
                    <thead>
                      <tr>
                        <th>Service</th>
                        <th>Started (UTC)</th>
                        <th>Duration</th>
                        <th>Failed checks</th>
                      </tr>
                    </thead>
                    <tbody>
                      {monthIncidents.map((i) => (
                        <tr key={`${i.service_id}-${i.started_at}`}>
                          <td>{i.service_id}</td>
                          <td>{fmtUtc(i.started_at)}</td>
                          <td>{fmtDuration(i.duration_minutes)}</td>
                          <td>{i.failed_checks}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>

              {upload && (
                <div>
                  <h3 className="subsection-heading">Latest upload</h3>
                  <p style={{ margin: "0 0 10px", fontSize: "0.875rem", color: "var(--text-secondary)" }}>
                    <strong>{upload.filename}</strong> — {upload.rows_accepted} of {upload.rows_total} rows accepted,{" "}
                    {upload.rows_rejected} rejected
                  </p>
                  <ul className="chips">
                    {Object.entries(upload.report ?? {}).map(([k, v]) => (
                      <li key={k}>
                        {k.replace(/_/g, " ")}: <strong>{v}</strong>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </>
          )}
        </div>
      )}
    </section>
  );
}
