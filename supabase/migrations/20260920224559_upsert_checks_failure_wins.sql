create or replace function upsert_checks(p_rows jsonb, p_upload_id uuid)
returns jsonb
language sql
as $$
  with incoming as (
    select *
    from jsonb_to_recordset(p_rows) as x(
      service_id text, service_name text, ts timestamptz,
      status_code int, latency_ms numeric, agent text, region text
    )
  ),
  classified as (
    select i.*, c.status_code as old_status
    from incoming i
    left join checks c on c.service_id = i.service_id and c.ts = i.ts
  ),
  written as (
    insert into checks
      (service_id, service_name, ts, status_code, latency_ms, agent, region, upload_id)
    select service_id, service_name, ts, status_code, latency_ms, agent, region, p_upload_id
    from classified
    on conflict (service_id, ts) do update
      set service_name = excluded.service_name,
          status_code  = excluded.status_code,
          latency_ms   = excluded.latency_ms,
          agent        = excluded.agent,
          region       = excluded.region,
          upload_id    = excluded.upload_id
      -- failure wins: only replace a healthy row with a failing one
      where excluded.status_code >= 500 and checks.status_code < 500
    returning 1
  )
  select jsonb_build_object(
    'new_slots',             count(*) filter (where old_status is null),
    'overlapping_slots',     count(*) filter (where old_status is not null),
    'turned_down',           count(*) filter (where old_status < 500 and status_code >= 500),
    'kept_existing_failure', count(*) filter (where old_status >= 500 and status_code < 500)
  )
  from classified;
$$;

-- Only the Edge Function (secret key) may call this, not the public publishable key
revoke execute on function upsert_checks(jsonb, uuid) from public, anon, authenticated;
grant execute on function upsert_checks(jsonb, uuid) to service_role;