create or replace view available_dates
with (security_invoker = true) as
select distinct (ts at time zone 'UTC')::date as day
from checks;