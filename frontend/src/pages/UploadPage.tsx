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
    <main style={{ padding: 16, maxWidth: 720 }}>
      <h1>Upload monitoring data</h1>
      <input
        type="file"
        accept=".csv,text/csv"
        onChange={(e) => setFile(e.target.files?.[0] ?? null)}
      />
      <button onClick={handleUpload} disabled={!file || busy} style={{ marginLeft: 8 }}>
        {busy ? "Processing…" : "Upload"}
      </button>

      {result && !result.ok && <p role="alert">Error: {result.error}</p>}

      {result?.ok && result.report && (
        <section>
          <h2>Upload processed</h2>
          <p>
            {result.report.accepted} of {result.report.total} rows accepted,{" "}
            {result.report.rejected} rejected.
          </p>
          <h3>Data cleaning</h3>
          <table>
            <tbody>
              {Object.entries(result.report.counts).map(([k, v]) => (
                <tr key={k}><td>{k.replace(/_/g, " ")}</td><td>{v}</td></tr>
              ))}
            </tbody>
          </table>
          {result.merge && (
            <>
              <h3>Merge with existing data</h3>
              <table>
                <tbody>
                  {Object.entries(result.merge).map(([k, v]) => (
                    <tr key={k}><td>{k.replace(/_/g, " ")}</td><td>{v}</td></tr>
                  ))}
                </tbody>
              </table>
            </>
          )}
          <p><Link to="/">View dashboard →</Link></p>
        </section>
      )}
    </main>
  );
}