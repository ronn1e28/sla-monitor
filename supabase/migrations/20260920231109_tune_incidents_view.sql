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
         case when prev_ts is null or ts - prev_ts > interval '45 minutes'
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
  (extract(epoch from (max(ts) - min(ts))) / 60)::int + 15 as duration_minutes,
  count(*) >= 4 as is_sustained
from grouped
group by service_id, grp;