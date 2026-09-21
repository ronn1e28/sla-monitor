import { useState } from "react";
import { Link } from "react-router-dom";
import { API_KEY, UPLOAD_URL } from "../lib/supabase";

type UploadResult = {
  ok: boolean;
  error?: string;
  report?: {
    total: number;
    accepted: number;
    rejected: number;
    counts: Record<string, number>;
  };
  merge?: Record<string, number>;
};

export default function UploadPage() {
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<UploadResult | null>(null);

  async function handleUpload() {
    if (!file) return;
    setBusy(true);
    setResult(null);
    try {
      const body = new FormData();
      body.append("file", file);
      const res = await fetch(UPLOAD_URL, {
        method: "POST",
        headers: { apikey: API_KEY },
        body,
      });
      setResult(await res.json());
    } catch (e) {
      setResult({ ok: false, error: e instanceof Error ? e.message : "Upload failed" });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="upload-page">
      <h1>Upload monitoring data</h1>

      <div className="upload-dropzone">
        <input
          type="file"
          accept=".csv,text/csv"
          onChange={(e) => setFile(e.target.files?.[0] ?? null)}
        />
        <p>Accepts .csv files exported from your monitoring tool</p>
      </div>

      <button
        className="primary"
        onClick={handleUpload}
        disabled={!file || busy}
        style={{ width: "fit-content" }}
      >
        {busy ? "Processing…" : "Upload CSV"}
      </button>

      {result && !result.ok && (
        <p role="alert">Error: {result.error}</p>
      )}

      {result?.ok && result.report && (
        <div className="upload-result">
          <h2>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="20 6 9 17 4 12" />
            </svg>
            Upload processed
          </h2>

          <div className="stat-row">
            <div className="stat-pill">
              <span className="val">{result.report.total}</span>
              <span className="lbl">Total</span>
            </div>
            <div className="stat-pill" style={{ borderColor: "var(--good-bg)" }}>
              <span className="val" style={{ color: "var(--good-text)" }}>{result.report.accepted}</span>
              <span className="lbl">Accepted</span>
            </div>
            <div className="stat-pill" style={{ borderColor: result.report.rejected > 0 ? "var(--bad-bg)" : undefined }}>
              <span className="val" style={{ color: result.report.rejected > 0 ? "var(--bad-text)" : undefined }}>
                {result.report.rejected}
              </span>
              <span className="lbl">Rejected</span>
            </div>
          </div>

          <div>
            <h3>Data cleaning</h3>
            <table className="upload-table">
              <tbody>
                {Object.entries(result.report.counts).map(([k, v]) => (
                  <tr key={k}>
                    <td>{k.replace(/_/g, " ")}</td>
                    <td>{v}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {result.merge && (
            <div>
              <h3>Merge with existing data</h3>
              <table className="upload-table">
                <tbody>
                  {Object.entries(result.merge).map(([k, v]) => (
                    <tr key={k}>
                      <td>{k.replace(/_/g, " ")}</td>
                      <td>{v}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          <Link to="/" className="view-dashboard-link">
            View dashboard →
          </Link>
        </div>
      )}
    </div>
  );
}
