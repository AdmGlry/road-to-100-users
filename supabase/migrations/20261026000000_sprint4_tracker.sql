-- =============================================================================
-- Sprint 4 — Suivi : synchronisation des réponses, relances, Kanban (SPEC §8, §9)
-- =============================================================================
-- NON-DESTRUCTIVE: only adds nullable / defaulted columns, indexes, functions
-- and pg_cron jobs. Production is migrated through a tool that blocks `drop`.
--
-- applications (follow-up lifecycle, all written by the server, never the client):
--   followup_status       null (none yet) | draft | sending | sent | dismissed
--   followup_approved_at  explicit validation of the follow-up by the student
--   followup_sent_at      when the follow-up left (same Gmail thread)
--   followup_error        user-safe (French) error of the last follow-up attempt
--   interview_notified_at the "entretien détecté" notification was sent (idempotency)
--   status_set_manually   the student moved the card on the board: the sync
--                         never moves it back automatically
-- replies: received messages of the app's own threads (classification by LLM).
-- Scheduling: pg_cron + pg_net (same Vault secrets as the send queue):
--   spontane-sync-replies  every hour  → POST /api/cron/sync-replies
--   spontane-followups     every day   → POST /api/cron/followups (07:10 UTC)
-- =============================================================================

alter table public.applications
  add column if not exists followup_status       text,
  add column if not exists followup_approved_at  timestamptz,
  add column if not exists followup_sent_at      timestamptz,
  add column if not exists followup_error        text,
  add column if not exists interview_notified_at timestamptz,
  add column if not exists status_set_manually   bool not null default false,
  add column if not exists replies_checked_at    timestamptz,
  add column if not exists followup_checked_at   timestamptz;

-- Fair rotation of the crons: least recently checked first, so a big or
-- failing account never starves the others.
alter table public.google_connections
  add column if not exists sync_attempted_at timestamptz;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'applications_followup_status_check') then
    alter table public.applications
      add constraint applications_followup_status_check
      check (followup_status is null
             or followup_status in ('draft', 'sending', 'sent', 'dismissed'));
  end if;
end
$$;

create index if not exists applications_user_id_status_sent_at_idx
  on public.applications (user_id, status, sent_at) where gmail_thread_id is not null;

comment on column public.applications.followup_status is
  'Follow-up (SPEC §8.3): null = none yet | draft | sending (claimed by the sender) | sent | dismissed.';
comment on column public.applications.followup_approved_at is
  'Explicit validation of the follow-up by the student. No follow-up is ever sent without it.';
comment on column public.applications.interview_notified_at is
  'The interview notification mail was sent to the student (never twice).';
comment on column public.applications.status_set_manually is
  'Moved by the student on the board: the reply sync no longer changes the status.';

-- -----------------------------------------------------------------------------
-- Generic cron ping (Vault secrets app_url / cron_secret), no-op when missing.
-- -----------------------------------------------------------------------------
create or replace function public.trigger_cron_endpoint(p_path text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_url    text;
  v_secret text;
begin
  if p_path is null or p_path !~ '^/api/cron/[a-z-]+$' then
    raise exception 'invalid cron path';
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
    using rtrim(v_url, '/') || p_path, v_secret;
end;
$$;

revoke all on function public.trigger_cron_endpoint(text) from public, anon, authenticated;

comment on function public.trigger_cron_endpoint(text) is
  'Called by pg_cron: POSTs {app_url}{p_path} with the cron secret (Vault). Service role / cron only.';

do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    if not exists (select 1 from cron.job where jobname = 'spontane-sync-replies') then
      perform cron.schedule('spontane-sync-replies', '7 * * * *',
        $c$select public.trigger_cron_endpoint('/api/cron/sync-replies')$c$);
    end if;
    if not exists (select 1 from cron.job where jobname = 'spontane-followups') then
      perform cron.schedule('spontane-followups', '10 7 * * *',
        $c$select public.trigger_cron_endpoint('/api/cron/followups')$c$);
    end if;
  end if;
end
$$;

-- -----------------------------------------------------------------------------
-- Client guard (20261025060000) extended to the Sprint 4 columns: follow-ups,
-- interview notification and manual board moves are written by the server only.
-- -----------------------------------------------------------------------------
create or replace function public.applications_guard_client_write()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if current_user not in ('authenticated', 'anon') then
    return new;
  end if;

  if tg_op = 'INSERT' then
    if new.status <> 'draft'
       or new.approved_at is not null
       or new.scheduled_for is not null
       or new.send_claimed_at is not null
       or new.sent_at is not null
       or new.gmail_message_id is not null
       or new.gmail_thread_id is not null
       or new.followup_status is not null
       or new.followup_approved_at is not null
       or new.followup_sent_at is not null
       or new.interview_notified_at is not null
       or new.status_set_manually then
      raise exception 'applications: forbidden client insert' using errcode = '42501';
    end if;
    return new;
  end if;

  if old.status not in ('draft', 'approved')
     or new.status not in ('draft', 'approved')
     or old.send_claimed_at is not null
     or new.send_claimed_at is distinct from old.send_claimed_at
     or new.sent_at is distinct from old.sent_at
     or new.gmail_message_id is distinct from old.gmail_message_id
     or new.gmail_thread_id is distinct from old.gmail_thread_id
     or new.lead_id is distinct from old.lead_id
     or new.followup_status is distinct from old.followup_status
     or new.followup_subject is distinct from old.followup_subject
     or new.followup_body is distinct from old.followup_body
     or new.followup_approved_at is distinct from old.followup_approved_at
     or new.followup_sent_at is distinct from old.followup_sent_at
     or new.followup_count is distinct from old.followup_count
     or new.interview_notified_at is distinct from old.interview_notified_at
     or new.status_set_manually is distinct from old.status_set_manually
     or (new.approved_at is not null and new.status <> 'approved')
     or (new.scheduled_for is not null
         and (new.status <> 'approved' or new.approved_at is null or new.contact_id is null)) then
    raise exception 'applications: forbidden client update' using errcode = '42501';
  end if;
  return new;
end;
$$;

revoke all on function public.applications_guard_client_write() from public, anon, authenticated;

-- -----------------------------------------------------------------------------
-- Spacing enforced with the quota, under the same per-user lock: no two sends
-- (applications or follow-ups) of a student less than 30 s apart (SPEC §7.6).
-- Quota reached → null (unchanged); too soon → exception 'send_too_soon'.
-- -----------------------------------------------------------------------------
create or replace function public.reserve_send_slot(
  p_user uuid,
  p_application uuid,
  p_limit int default 20
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid;
begin
  perform pg_advisory_xact_lock(hashtextextended('send_quota:' || p_user::text, 0));
  if (
    select count(*)
    from public.send_log
    where user_id = p_user
      and sent_at > now() - interval '24 hours'
  ) >= p_limit then
    return null;
  end if;
  if exists (
    select 1 from public.send_log
    where user_id = p_user
      and sent_at > now() - interval '30 seconds'
  ) then
    raise exception 'send_too_soon' using errcode = 'P0001';
  end if;
  insert into public.send_log (user_id, application_id)
  values (p_user, p_application)
  returning id into v_id;
  return v_id;
end;
$$;

revoke all on function public.reserve_send_slot(uuid, uuid, int) from public, anon, authenticated;
grant execute on function public.reserve_send_slot(uuid, uuid, int) to service_role;
