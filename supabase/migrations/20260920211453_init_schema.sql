-- Tables
create table uploads (
  id uuid primary key default gen_random_uuid(),
  filename text,
  uploaded_at timestamptz not null default now(),
  rows_total int,
  rows_accepted int,
  rows_rejected int
);

create table checks (
  service_id text not null,
  service_name text not null,
  ts timestamptz not null,
  status_code int not null,
  latency_ms numeric,            -- null when missing or invalid
  agent text,
  region text,
  upload_id uuid references uploads(id),
  primary key (service_id, ts)   -- makes re-uploads idempotent via upsert
);

create index on checks (ts);

create table rejected_rows (
  id bigserial primary key,
  upload_id uuid references uploads(id),
  raw jsonb not null,
  reason text not null
);

-- Row Level Security: browser can read, only the service role can write
alter table uploads       enable row level security;
alter table checks        enable row level security;
alter table rejected_rows enable row level security;

create policy "anon can read checks"
  on checks for select to anon using (true);

create policy "anon can read uploads"
  on uploads for select to anon using (true);