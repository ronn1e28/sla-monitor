-- Monthly availability per service (UTC calendar months)
create or replace view monthly_availability
with (security_invoker = true) as
with m as (
  select
    service_id,
    max(service_name) as service_name,
    date_trunc('month', ts at time zone 'UTC') as month_start,
    count(*) as total_checks,
    count(*) filter (where status_code >= 500) as down_checks
  from checks
  group by service_id, date_trunc('month', ts at time zone 'UTC')
)
select
  service_id,
  service_name,
  month_start::date as month,
  total_checks,
  down_checks,
  round(100.0 * (total_checks - down_checks) / total_checks, 3) as availability_pct,
  down_checks * 15 as downtime_minutes,
  round(100.0 * total_checks /
    (extract(day from (month_start + interval '1 month' - interval '1 day'))::int * 96), 1)
    as coverage_pct,
  (100.0 * (total_checks - down_checks) / total_checks) < 99.9 as breached
from m;

-- Incidents: failures within 30 minutes of each other form one incident
create or replace view incidents
with (security_invoker = true) as
with down as (
  select service_id, ts,
         lag(ts) over (partition by service_id order by ts) as prev_ts
  from checks
  where status_code >= 500
),
flagged as (
  select *,
         case when prev_ts is null or ts - prev_ts > interval '30 minutes'
              then 1 else 0 end as is_start
  from down
),
grouped as (
  select *, sum(is_start) over (partition by service_id order by ts) as grp
  from flagged
)
select
  service_id,
  min(ts) as started_at,
  max(ts) + interval '15 minutes' as ended_at,
  count(*) as failed_checks,
  (extract(epoch from (max(ts) - min(ts))) / 60)::int + 15 as duration_minutes
from grouped
group by service_id, grp;