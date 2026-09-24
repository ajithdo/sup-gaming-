-- =============================================================================
-- NextLevel Gaming Zone — realtime + scheduled housekeeping
-- =============================================================================

-- Let the admin dashboard receive live booking changes. Realtime still applies
-- RLS, so customers only ever receive events for their own bookings.
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
     and not exists (
       select 1 from pg_publication_tables
        where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'bookings'
     ) then
    alter publication supabase_realtime add table public.bookings;
  end if;
end;
$$;

-- Every minute, mark holds that ran out as 'expired' so dashboards show the
-- right status. (Availability checks already ignore stale holds, so the site
-- stays correct even if pg_cron isn't enabled on your project.)
do $$
begin
  if exists (select 1 from pg_available_extensions where name = 'pg_cron') then
    create extension if not exists pg_cron;
    execute $cron$ select cron.schedule('nextlevel-expire-holds', '* * * * *', 'select public.expire_stale_holds()') $cron$;
  else
    raise notice 'pg_cron is not available; skipping the expire-holds job.';
  end if;
exception when others then
  raise notice 'Could not schedule the expire-holds job (%). Enable pg_cron in the dashboard and re-run this block.', sqlerrm;
end;
$$;
