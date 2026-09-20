export type MonthlyRow = {
  service_id: string;
  service_name: string;
  month: string; // first day of the month, YYYY-MM-DD
  total_checks: number;
  down_checks: number;
  availability_pct: number;
  downtime_minutes: number;
  coverage_pct: number;
  breached: boolean;
};

export type IncidentRow = {
  service_id: string;
  started_at: string;
  ended_at: string;
  failed_checks: number;
  duration_minutes: number;
  is_sustained: boolean;
};

export type UploadRow = {
  id: string;
  filename: string | null;
  uploaded_at: string;
  rows_total: number | null;
  rows_accepted: number | null;
  rows_rejected: number | null;
  report: Record<string, number> | null;
};

export type CheckRow = {
  service_id: string;
  service_name: string;
  ts: string;
  status_code: number;
  latency_ms: number | null;
  agent: string | null;
  region: string | null;
};