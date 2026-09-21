# SLA Monitor

Upload a multi-day CSV of health checks, clean it in a cloud function, store it in Postgres, and inspect it on a single-screen dashboard (collapsible service-health stats on top, date-filtered check logs below).

## Live URLs

| What | URL |
|---|---|
| Dashboard | `<LIVE-DASHBOARD-URL>/#/` |
| Upload page | `<LIVE-DASHBOARD-URL>/#/upload` |
| Cloud function (POST) | `https://<PROJECT-REF>.supabase.co/functions/v1/process-upload` |
| Database | Supabase Postgres (not directly exposed; the dashboard reads it through the Supabase API) |

**Last verified live:** `<DATE>`

The database and function run on Supabase's free tier, which pauses a project after a period of inactivity. If the dashboard shows an error, open the Supabase dashboard and click *Restore project*, or see [Redeploying](#running-and-redeploying) to recreate everything from scratch.

## Architecture

```
 Browser (Vercel, static)                Supabase
┌──────────────────────────┐   POST    ┌──────────────────────────────┐
│ Upload page  (#/upload)  │──────────▶│ Edge Function: process-upload │
│                          │ multipart │  1. parse CSV                 │
│ Dashboard    (#/)        │           │  2. validate + clean          │
│  ├─ Service health stats │           │  3. merge into DB (RPC)       │
│  └─ Check logs           │           └───────────────┬──────────────┘
└────────────┬─────────────┘                           │ secret key
             │ read-only (publishable key + RLS)       ▼
             │                         ┌──────────────────────────────┐
             └────────────────────────▶│ Postgres                      │
                                       │  tables: checks, uploads,     │
                                       │          rejected_rows        │
                                       │  views:  monthly_availability,│
                                       │          incidents,           │
                                       │          available_dates      │
                                       └──────────────────────────────┘
```

| Piece | Runs on | Why |
|---|---|---|
| Frontend (Vite + React + TypeScript) | Vercel, static | Free, no card, deploys from GitHub. `HashRouter` means no rewrite rules are needed, and the upload page and dashboard each get their own URL. |
| Processing function | Supabase Edge Function (Deno) | A real deployed stateless function on free tier. It receives the file, runs the pure cleaning module, and writes to the database. It is the only component that holds the secret key. |
| Database | Supabase Postgres | The stats are aggregations over time (availability, incident runs, date-range filters), which SQL does far better than a key-value store. A composite primary key `(service_id, ts)` makes uploads idempotent. |
| Stats | SQL views | Availability and incidents are computed in the database, so the UI only displays them and the numbers can be checked directly in SQL. |

I put the function and database on the same provider to keep setup and redeployment simple. I considered Cloudflare Workers + D1 and AWS Lambda; I wasn't confident a 15k-row parse would fit Workers' free CPU limit, and AWS needs a card at signup.

**Data flow**

1. The user picks a CSV on the upload page, which POSTs it as `multipart/form-data` (field `file`) with the publishable key in the `apikey` header.
2. `clean.ts` (pure, no I/O) parses and validates the text and returns `{ rows, rejected, report }`.
3. The function creates an `uploads` row, then calls the SQL function `upsert_checks` in batches of 1,000 rows to merge into `checks`.
4. Rejected rows are stored in `rejected_rows` with the reason. The per-upload cleaning report and merge counts are stored on the `uploads` row.
5. The upload page shows the cleaning and merge report. The dashboard reads `monthly_availability`, `incidents`, `uploads` and `checks` directly.

**Security model**

There is no authentication (out of scope), so the design keeps the public surface small:

- The browser holds only the *publishable* key. RLS is enabled on every table, and the anon role can only `select` from `checks` and `uploads`. `rejected_rows` is not readable from the browser.
- Writes happen only in the function, using the *secret* key from the function's environment. `upsert_checks` has execute revoked from `public`, `anon` and `authenticated`.
- The views use `security_invoker`, so they respect the same RLS as the tables underneath.
- The function has JWT verification turned off, because the new publishable/secret keys are not JWTs. It caps uploads at 10 MB, and CORS is open (`*`). See [What I'd do differently](#what-id-do-differently).

## Data findings

The five provided files hold 4,672 to 15,577 rows each. All had the same classes of problem:

| Issue | What I found | How it's handled |
|---|---|---|
| Duplicate checks | About 7.5% of rows in every file. Mostly `agent-2` re-reporting a slot `agent-1` already reported, plus some exact duplicates | Deduplicate on `(service_id, timestamp)`. If the copies agree on status, keep one (preferring the one with a usable latency). If they disagree, the failure wins |
| Mixed timestamp formats | Mostly ISO `...Z`, about 1.5% Unix epoch seconds, about 0.7% ISO with a `+05:30` offset | All normalized to UTC. A timestamp without an explicit timezone is rejected rather than guessed |
| Mixed latency units | `svc-search` reports seconds (`0.486, s`), everything else milliseconds. About 20% of rows | Converted to ms |
| Missing latency | 56 to 186 blank values per file (about 1.2%), almost all on successful checks | Row kept (the up/down result is valid); latency stored as null so it doesn't distort averages |
| Invalid status code | Exactly one `999` row per file | Rejected and recorded in `rejected_rows` |
| Impossible latency | Exactly one negative value per file (e.g. `-296`) | Latency nulled, row kept |
| Row order and line endings | Rows are shuffled; CRLF line endings | Parsed with a small RFC-4180-style parser and sorted after parsing |

Per-file counts from the cleaner:

| File | Rows | Accepted | Duplicates removed | Epoch ts | Offset ts | Seconds→ms | Missing latency |
|---|---|---|---|---|---|---|---|
| 9d | 4,672 | 4,319 | 352 | 70 | 32 | 924 | 56 |
| 12d | 6,230 | 5,759 | 470 | 93 | 43 | 1,229 | 74 |
| 14d | 7,269 | 6,720 | 548 | 109 | 50 | 1,434 | 87 |
| 21d | 10,904 | 10,079 | 824 | 163 | 76 | 2,150 | 130 |
| 30d | 15,577 | 14,399 | 1,177 | 233 | 109 | 3,095 | 186 |

Each file also has 1 invalid status and 1 negative latency. In every file `rows = accepted + rejected + duplicates removed`, so no row disappears silently.

**Coverage.** After deduplication every service has exactly `days × 96` slots. The only holes are slots whose sole copy was the `999` row (`svc-payments` May 10 22:30 in the 9d file, `svc-search` Apr 4 20:00 in the 21d file). In the other files another agent or another file covered the slot.

**Files overlap, and they are independent samples, not views of one truth.** The 12d, 21d and 30d files cover overlapping April dates. On shared slots the latency is almost never identical (under 1%), and the status differs in about 2.5% of them (e.g. 142 of 5,758 slots between the 12d and 30d files). The 12d file's `svc-search` outage on Apr 14 has 16 failing checks in that file but only 2 in the 21d file. So the upload order matters unless the merge is designed for it. See [Overlapping uploads](#overlapping-uploads).

**Failures are not only outages.** Outside the logged incidents there is a steady baseline of isolated failures: roughly 2.5% for `svc-reports`, about 1% for `svc-payments` and about 0.2% for the others. Against a 99.9% target this breaches every service-month in the data (all 15), which shaped the dashboard: the breach flag alone tells you nothing, so the cards show downtime against the allowed budget and incidents are separated from isolated failures.

**Incident windows are not solid runs.** In the payments outage on Apr 5, only 16 of the 23 checks in the window fail. A "consecutive failures" rule would split that outage in two, which is why incidents use a gap tolerance (see assumptions).

**Validation against the incident log.** I used `dataset_incident_log.json` only as an answer key to test the pipeline, and the app does not read it. With the final incident definition, the `incidents` view returns exactly the 8 logged outages, each as one row, with no false positives. Two boundaries drift: the `svc-search` incident on Apr 14 starts 30 minutes early (a stray failure is absorbed), and the `svc-reports` incident on May 13 ends at 18:00 against a logged 17:15.

## Assumptions

1. **What counts as down:** an HTTP status of 500 or above. Any other valid status is up.
2. **Availability** = successful checks ÷ valid checks, per service, per UTC calendar month, against a 99.9% target. Downtime minutes = failed checks × 15. Missing checks are not counted as downtime, since I can't tell whether a service was down or the agent was.
3. **Rejected rows** (invalid timestamp, invalid status, missing service) leave the slot empty rather than counting as a failure. I don't want garbage to count as evidence of an outage.
4. **Partial months.** The data covers Apr 3 – May 5, May 8–16 and May 19 – Jun 1, so most months are incomplete. Each service-month carries `coverage_pct` = checks ÷ (days in month × 96). Below 50% coverage the dashboard shows "Insufficient data" instead of a verdict (June has one day). The 50% cutoff is my own choice.
5. **Sustained incident** = failed checks no more than 45 minutes apart, with at least 4 of them (roughly an hour). I tuned both numbers by testing 9 combinations against the incident log: a 30-minute gap split the payments outage and a threshold of 3 admitted noise from the flaky `svc-reports`. Because it was tuned on five files, treat it as a reasoned default. Isolated failures still appear in the logs and in the availability numbers, but not in the incident list. An incident's end is its last failing check.
6. **Dates and times are UTC** everywhere, including the log filter (a date covers 00:00 to 24:00 UTC). The date pickers are limited to the earliest and latest date that has data, and the available ranges are listed next to them. A day inside a gap simply returns "No checks match".
7. **The upload is synchronous** and limited to 10 MB. A 30-day file (about 15.5k rows) is processed in one request.

### Overlapping uploads

The database holds one row per `(service, timestamp)`. When an upload covers a slot that already exists, the SQL function `upsert_checks` applies a **failure-wins** rule: a failing check replaces a healthy one, and a healthy check never replaces a failure.

- **Why:** the alternatives were "latest upload wins" and "first wins", and both make the result depend on upload order. Latest-wins can also silently erase a recorded outage. Failure-wins is consistent with the in-file rule for duplicate agents.
- **Verified:** I loaded all five files in name order and again in reverse order. Both runs gave identical per-service totals (5,376 / 5,376 / 5,375 / 5,376 / 5,375 slots, 26,878 in total) and identical failure counts (auth 48, notify 49, payments 110, reports 228, search 90).
- **What is and isn't order-independent:** the up/down verdict of every slot is. Other fields (latency, agent, which upload wrote the row) keep the first stored row, and the specific 5xx code can differ between orders.
- **Cost:** when two overlapping uploads are independent samples, as here, their random failures accumulate, so downtime is over-counted. In the Apr 10–21 window that all three files cover, the average failure rate goes from about 1.15% per file to 3.4% merged. `svc-reports` shows 5.5% failures in April (three overlapping files) against 2.9% in May (almost no overlap). Re-uploading the same file changes nothing.
- Each upload's response and stored report include `new_slots`, `overlapping_slots`, `turned_down` (healthy slots the upload turned into failures) and `kept_existing_failure`, so an overlap is visible and not silent.

### Stats I chose, and why

The stats section is collapsible and is meant to serve both an on-call engineer and someone in billing:

- **Per-service monthly availability** with the 99.9% verdict, downtime minutes against the allowed budget (99.9% of the observed minutes), sustained-incident count and data coverage. Billing needs the number and whether it crosses the threshold. Coverage stops a partial month from looking like a full one.
- **Sustained incidents** for the selected month (start, duration, failed checks). On-call needs to know what actually broke and when, not every isolated failure.
- **Latest upload's data-quality report:** rows accepted and rejected, duplicates removed, conversions made, plus how the merge changed existing data. The point of the pipeline is that the numbers are trustworthy, so what it did to the data should be visible.

The logs view shows the underlying checks (newest first, 100 per page), filterable by a single date or a date range, with a "failures only" toggle.

## Running and redeploying

**Prerequisites:** Node 20+, a Supabase account (free), and optionally a Vercel account. The Supabase CLI runs through `npx`.

```bash
git clone https://github.com/ronn1e28/sla-monitor.git
cd sla-monitor
npm install                # root tooling for the local check scripts (tsx, typescript)
cd frontend && npm install
```

**1. Database and function (Supabase)**

1. Create a project at supabase.com and note the project ref (in the dashboard URL).
2. From the repo root:

```bash
npx supabase login
npx supabase link --project-ref <PROJECT-REF>
npx supabase db push                                   # tables, RLS, merge function, views
npx supabase functions deploy process-upload           # verify_jwt = false is set in supabase/config.toml
```

**2. Frontend (local)**

Copy `frontend/.env.example` to `frontend/.env` and fill it in from *Project Settings → API Keys*:

```
VITE_SUPABASE_URL=https://<PROJECT-REF>.supabase.co
VITE_SUPABASE_PUBLISHABLE_KEY=sb_publishable_...
```

```bash
cd frontend
npm run dev
```

Vite reads these values when it starts, so restart it after changing them. Never put the secret key (`sb_secret_...`) in the frontend.

**3. Load data**

Use the Upload page, or call the function directly (on Windows PowerShell use `curl.exe`):

```bash
curl -X POST "https://<PROJECT-REF>.supabase.co/functions/v1/process-upload" \
  -H "apikey: <PUBLISHABLE_KEY>" \
  -F "file=@sample-data/monitoring_checks_9d_seed101.csv"
```

**4. Deploy the frontend (Vercel)**

Import the GitHub repo, set the **Root Directory** to `frontend`, and add `VITE_SUPABASE_URL` and `VITE_SUPABASE_PUBLISHABLE_KEY` as environment variables (type *Config*; both values are public by design). Then redeploy: the values are baked in at build time, so changing them has no effect on an existing build.

**Local verification scripts** (no database needed):

```bash
npx tsx scripts/check-clean.ts                 # cleaning report for every CSV in sample-data/
npx tsx scripts/compare-overlap.ts a.csv b.csv # how two overlapping files disagree
```

There are no automated tests yet; these scripts and the SQL checks described above are how I validated the pipeline.

### Repository layout

```
sla-monitor/
├── frontend/                 Vite + React + TypeScript (upload page, dashboard)
│   └── src/{pages,components,lib}
├── supabase/
│   ├── config.toml           verify_jwt = false for process-upload
│   ├── migrations/           schema + RLS, merge function, stats views
│   └── functions/process-upload/
│       ├── index.ts          HTTP handler: parse → clean → merge → persist
│       └── clean.ts          pure cleaning module (no I/O)
├── scripts/                  local verification scripts
├── sample-data/              the five provided CSVs
└── README.md
```

## What I'd do differently

- **Tests and CI-free confidence:** unit tests for `clean.ts` (every issue above becomes a test case) and a test for the merge function's order independence, instead of relying on scripts.
- **Overlap handling:** store each source's observation (per upload or agent) and derive the verdict from all of them, or refuse conflicting overlaps. Failure-wins is defensible but over-counts downtime when sources are independent.
- **Incident detection:** the 45-minute / 4-check definition was tuned on five files. I'd validate it on more data, or make it configurable.
- **Public function hardening:** restrict CORS to the frontend origin, add rate limiting, and add authentication with per-tenant data.
- **Scale:** the upload is processed in a single request. Large files should go to storage and be processed in the background with a status the UI can poll. The stats views are computed on the fly, so at larger volumes I'd use materialized views or rollup tables.
- **SLA semantics:** configurable targets, credit tiers, treating missing checks as "unknown" explicitly, and latency percentiles (p50/p95) on the dashboard.
- **UI:** grey out individual days with no data (a custom day picker), charts of availability over time, CSV export, and an accessibility pass. The dashboard is currently dark-mode only with JetBrains Mono for stat numbers.

## AI tools

I used Claude as a pairing tool for scaffolding, SQL and code review. The design decisions above (failure-wins merge, incident definition, partial-month handling, security model) are ones I made after looking at the actual data, and I can explain each.