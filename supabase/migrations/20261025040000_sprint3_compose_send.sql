-- =============================================================================
-- Sprint 3 — Chasseur : contact, rédaction, envoi (SPEC §6, §7.4–7.6)
-- =============================================================================
-- NON-DESTRUCTIVE: only adds nullable / defaulted columns, indexes and
-- functions. Production is migrated through a tool that blocks `drop`.
--
-- leads: preparation queue (enrichment + mail composition run in the
--   background, resumed by the review screen / the next call when the
--   function time budget is exhausted).
-- applications:
--   - claims_used / claims_unverified / quality_warnings: output of prompt
--     compose_application and of the automatic checks (lib/hunter/claims.ts);
--   - company_insight_source: URL of the verified hook (null = activity-based);
--   - approved_at: explicit human validation (required before any send);
--   - send_claimed_at: lock taken by the send worker so that two workers
--     never send the same mail.
--   One application per lead (unique index).
-- reserve_send_slot(): atomic quota (20 sends / rolling 24 h, SPEC §7.6),
--   per-user advisory lock + send_log insert in one statement. Service role only.
-- =============================================================================

alter table public.leads
  add column if not exists prep_status     text,
  add column if not exists prep_error      text,
  add column if not exists prep_started_at timestamptz;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'leads_prep_status_check') then
    alter table public.leads
      add constraint leads_prep_status_check
      check (prep_status is null or prep_status in ('queued', 'running', 'done', 'failed'));
  end if;
end
$$;

create index if not exists leads_user_id_prep_status_idx
  on public.leads (user_id, prep_status) where prep_status is not null;

comment on column public.leads.prep_status is
  'Preparation queue (website, contact, insight, mail): queued | running | done | failed; null = never queued.';
comment on column public.leads.prep_error is 'User-safe (French) error when prep_status = failed.';

alter table public.applications
  add column if not exists claims_used            text[] not null default '{}',
  add column if not exists claims_unverified      text[] not null default '{}',
  add column if not exists quality_warnings       text[] not null default '{}',
  add column if not exists company_insight_source text,
  add column if not exists approved_at            timestamptz,
  add column if not exists send_claimed_at        timestamptz;

create unique index if not exists applications_lead_id_key on public.applications (lead_id);

comment on column public.applications.claims_used is
  'Profile elements the model says it used (prompt compose_application).';
comment on column public.applications.claims_unverified is
  'claims_used items not found in the profile after one regeneration: shown to the student.';
comment on column public.applications.quality_warnings is
  'Other quality problems left after the single regeneration (French, shown to the student).';
comment on column public.applications.company_insight_source is
  'Source URL of company_insight; null when the hook is based on the company activity.';
comment on column public.applications.approved_at is
  'Explicit validation by the student. No mail is ever sent without it.';
comment on column public.applications.send_claimed_at is
  'Set by the send worker while sending (row lock); stale after 5 minutes.';

-- -----------------------------------------------------------------------------
-- Atomic quota reservation
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
  -- Serialises concurrent reservations of the same user (released at commit).
  perform pg_advisory_xact_lock(hashtextextended('send_quota:' || p_user::text, 0));
  if (
    select count(*)
    from public.send_log
    where user_id = p_user
      and sent_at > now() - interval '24 hours'
  ) >= p_limit then
    return null;
  end if;
  insert into public.send_log (user_id, application_id)
  values (p_user, p_application)
  returning id into v_id;
  return v_id;
end;
$$;

revoke all on function public.reserve_send_slot(uuid, uuid, int) from public, anon, authenticated;
grant execute on function public.reserve_send_slot(uuid, uuid, int) to service_role;

comment on function public.reserve_send_slot(uuid, uuid, int) is
  'Reserves one send in the rolling 24 h quota (inserts into send_log) or returns null '
  'when the quota is reached. Delete the send_log row if the send then fails. Service role only.';
