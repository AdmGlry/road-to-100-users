-- =============================================================================
-- Sprint 3 — send queue heartbeat (SPEC §7.6, §15: pg_cron every minute)
-- =============================================================================
-- Every minute, if at least one validated mail is due, pg_cron calls
-- POST {app_url}/api/cron/send-queue with "Authorization: Bearer {cron_secret}"
-- through pg_net. Both values are read from Supabase Vault (secrets named
-- `app_url` and `cron_secret`); when either is missing the function does
-- nothing. The review screen also processes the queue while it is open, so
-- sending works even before the Vault secrets are set.
--
-- NON-DESTRUCTIVE and guarded: on a database without pg_cron / pg_net / vault
-- (e.g. the vanilla Postgres used by supabase/tests), only the function is
-- created and no job is scheduled.
-- =============================================================================

do $$
begin
  if exists (select 1 from pg_available_extensions where name = 'pg_net') then
    create extension if not exists pg_net;
  end if;
  if exists (select 1 from pg_available_extensions where name = 'pg_cron') then
    create extension if not exists pg_cron;
  end if;
end
$$;

create or replace function public.trigger_send_queue()
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_url    text;
  v_secret text;
begin
  if not exists (
    select 1 from public.applications
    where status = 'approved' and scheduled_for is not null and scheduled_for <= now()
  ) then
    return;
  end if;
  if to_regclass('vault.decrypted_secrets') is null or not exists (
    select 1 from pg_catalog.pg_proc p
    join pg_catalog.pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'net' and p.proname = 'http_post'
  ) then
    return;
  end if;
  execute $q$select decrypted_secret from vault.decrypted_secrets where name = 'app_url' limit 1$q$
    into v_url;
  execute $q$select decrypted_secret from vault.decrypted_secrets where name = 'cron_secret' limit 1$q$
    into v_secret;
  if v_url is null or v_secret is null then
    return;
  end if;
  execute $q$select net.http_post(
      url := $1,
      headers := jsonb_build_object('Authorization', 'Bearer ' || $2, 'Content-Type', 'application/json'),
      body := '{}'::jsonb,
      timeout_milliseconds := 5000
    )$q$
    using rtrim(v_url, '/') || '/api/cron/send-queue', v_secret;
end;
$$;

revoke all on function public.trigger_send_queue() from public, anon, authenticated;

comment on function public.trigger_send_queue() is
  'Called every minute by pg_cron: pings /api/cron/send-queue when a validated mail is due.';

do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    if not exists (select 1 from cron.job where jobname = 'spontane-send-queue') then
      perform cron.schedule('spontane-send-queue', '* * * * *', 'select public.trigger_send_queue()');
    end if;
  end if;
end
$$;
