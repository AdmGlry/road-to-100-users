-- =============================================================================
-- Spontané — initial schema (SPEC §4)
-- =============================================================================
--
-- Team decisions that deviate from / extend SPEC §4:
--
--  1. `contacts` and `replies` carry their own `user_id uuid not null`
--     (simpler and safer RLS than joining through leads/applications).
--     Composite foreign keys (child.parent_id, child.user_id) ->
--     parent(id, user_id) guarantee a child row always belongs to the same
--     user as its parent (a user cannot attach a contact to someone else's
--     lead, etc.).
--  2. `applications` gets:
--       - `scheduled_for timestamptz null` (send queue, processed every minute
--         by the server for rows with status = 'approved'),
--       - `followup_subject text null`, `followup_body text null` (follow-up
--         draft),
--       - `send_error text null` (last send failure, shown to the user).
--     `contact_id` is nullable (contact deletion sets it to null instead of
--     deleting the application history).
--  3. `companies` is a shared cache: RLS enabled, SELECT allowed for
--     `authenticated`, no insert/update/delete policy (service role only).
--  4. `google_connections`: RLS enabled with NO client policy and all client
--     privileges revoked (service role only, tokens never reach the browser).
--     Clients read their connection status through the view
--     `public.google_connection_status` (see its definition below).
--     Because a view and a type cannot share a name in the same schema (the
--     view's row type is named after it), the status ENUM is named
--     `public.google_connection_state` instead of `google_connection_status`.
--  5. `send_log`: clients may SELECT their own rows only; inserts/updates/
--     deletes are service-role only, so the daily quota (20 sends / 24h) is
--     server-enforced and cannot be forged or erased by a client.
--     `send_log.application_id` is `on delete set null` so that deleting an
--     application does NOT reset the quota.
--     `events`: clients may SELECT and INSERT their own rows only.
--  6. User-owned tables (profiles, searches, leads, contacts, applications):
--     select/insert/update/delete policies with
--     `user_id = (select auth.uid())` in USING and WITH CHECK.
--     Exception: `replies` and `send_log` are select-only for clients (writes
--     come from the cron/server with the service role).
--  7. `leads.search_id` is nullable (`on delete set null`): deleting a search
--     keeps the leads the user already worked on. `leads.company_id` is
--     `on delete restrict` (the shared cache must not silently wipe leads).
--  8. A `profiles` row is auto-created on signup (trigger on auth.users);
--     profile fields the user has not filled yet are nullable, arrays default
--     to '{}' and jsonb lists to '[]'.
--  9. GDPR: every user-owned row cascades from auth.users(id), so deleting
--     the auth user deletes all their data (CV files in Storage must still be
--     removed by the account-deletion route through the Storage API).
-- 10. `public.sends_in_last_24h(uuid)` helper (security definer) for the
--     server quota; EXECUTE is granted to service_role only.
-- 11. Private Storage bucket `cvs` (PDF only, 5 MB), objects stored under
--     `<user_id>/...`, each user can only access their own folder.
-- =============================================================================

-- gen_random_uuid() is built into PostgreSQL >= 13, no extension needed.

-- -----------------------------------------------------------------------------
-- Enums
-- -----------------------------------------------------------------------------
create type public.contract_type as enum ('alternance', 'stage', 'cdi', 'cdd');
create type public.google_connection_state as enum ('active', 'expired', 'revoked');
create type public.search_status as enum ('running', 'done', 'failed');
create type public.lead_status as enum ('suggested', 'selected', 'dismissed', 'drafted', 'sent');
create type public.contact_source as enum ('pattern_guess', 'generic', 'user_input', 'website');
create type public.contact_confidence as enum ('low', 'medium', 'high');
create type public.application_status as enum (
  'draft', 'approved', 'sent', 'replied', 'interview', 'rejected', 'no_reply', 'bounced'
);
create type public.reply_classification as enum (
  'interview', 'rejection', 'info_request', 'positive_other', 'auto_reply', 'bounce', 'other'
);

-- -----------------------------------------------------------------------------
-- Shared updated_at trigger function
-- -----------------------------------------------------------------------------
create or replace function public.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

-- -----------------------------------------------------------------------------
-- profiles
-- -----------------------------------------------------------------------------
create table public.profiles (
  id               uuid primary key default gen_random_uuid(),
  user_id          uuid not null unique references auth.users (id) on delete cascade,
  full_name        text,
  email            text,
  phone            text,
  city             text,
  school           text,
  degree           text,
  contract_type    public.contract_type,
  rhythm           text,
  start_date       date,
  target_roles     text[] not null default '{}',
  target_sectors   text[] not null default '{}',
  search_radius_km int not null default 30 check (search_radius_km between 0 and 1000),
  skills           text[] not null default '{}',
  experiences      jsonb not null default '[]'::jsonb check (jsonb_typeof(experiences) = 'array'),
  education        jsonb not null default '[]'::jsonb check (jsonb_typeof(education) = 'array'),
  languages        jsonb not null default '[]'::jsonb check (jsonb_typeof(languages) = 'array'),
  pitch            text,
  cv_storage_path  text,
  cv_text          text,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);

-- -----------------------------------------------------------------------------
-- google_connections (service role only)
-- -----------------------------------------------------------------------------
create table public.google_connections (
  id                uuid primary key default gen_random_uuid(),
  user_id           uuid not null unique references auth.users (id) on delete cascade,
  google_email      text not null,
  access_token_enc  text not null,
  refresh_token_enc text,
  scopes            text[] not null default '{}',
  expires_at        timestamptz,
  status            public.google_connection_state not null default 'active',
  last_sync_at      timestamptz,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

-- -----------------------------------------------------------------------------
-- searches
-- -----------------------------------------------------------------------------
create table public.searches (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references auth.users (id) on delete cascade,
  params        jsonb not null default '{}'::jsonb,
  status        public.search_status not null default 'running',
  results_count int not null default 0 check (results_count >= 0),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  unique (id, user_id)
);

-- -----------------------------------------------------------------------------
-- companies (shared cache)
-- -----------------------------------------------------------------------------
create table public.companies (
  id              uuid primary key default gen_random_uuid(),
  siren           text not null,
  name            text not null,
  naf_code        text,
  naf_label       text,
  headcount_range text,
  address         text,
  postal_code     text,
  city            text,
  lat             double precision,
  lng             double precision,
  website         text,
  domain          text,
  leaders         jsonb not null default '[]'::jsonb,
  raw             jsonb,
  enriched_at     timestamptz,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

-- -----------------------------------------------------------------------------
-- leads
-- -----------------------------------------------------------------------------
create table public.leads (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users (id) on delete cascade,
  search_id   uuid,
  company_id  uuid not null references public.companies (id) on delete restrict,
  fit_score   int check (fit_score between 0 and 100),
  fit_reasons text[] not null default '{}',
  status      public.lead_status not null default 'suggested',
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  unique (id, user_id),
  foreign key (search_id, user_id)
    references public.searches (id, user_id) on delete set null (search_id)
);

-- -----------------------------------------------------------------------------
-- contacts
-- -----------------------------------------------------------------------------
create table public.contacts (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references auth.users (id) on delete cascade,
  lead_id    uuid not null,
  first_name text,
  last_name  text,
  role       text,
  email      text not null,
  source     public.contact_source not null,
  confidence public.contact_confidence not null default 'low',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, user_id),
  foreign key (lead_id, user_id)
    references public.leads (id, user_id) on delete cascade
);

-- -----------------------------------------------------------------------------
-- applications
-- -----------------------------------------------------------------------------
create table public.applications (
  id               uuid primary key default gen_random_uuid(),
  user_id          uuid not null references auth.users (id) on delete cascade,
  lead_id          uuid not null,
  contact_id       uuid,
  subject          text not null default '',
  body             text not null default '',
  company_insight  text,
  prompt_version   text,
  edited_by_user   bool not null default false,
  status           public.application_status not null default 'draft',
  scheduled_for    timestamptz,
  send_error       text,
  gmail_message_id text,
  gmail_thread_id  text,
  sent_at          timestamptz,
  last_reply_at    timestamptz,
  next_followup_at timestamptz,
  followup_count   int not null default 0 check (followup_count >= 0),
  followup_subject text,
  followup_body    text,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  unique (id, user_id),
  foreign key (lead_id, user_id)
    references public.leads (id, user_id) on delete cascade,
  foreign key (contact_id, user_id)
    references public.contacts (id, user_id) on delete set null (contact_id)
);

-- -----------------------------------------------------------------------------
-- replies
-- -----------------------------------------------------------------------------
create table public.replies (
  id                        uuid primary key default gen_random_uuid(),
  user_id                   uuid not null references auth.users (id) on delete cascade,
  application_id            uuid not null,
  gmail_message_id          text not null,
  received_at               timestamptz not null,
  from_email                text,
  snippet                   text check (char_length(snippet) <= 200),
  classification            public.reply_classification,
  classification_confidence double precision
    check (classification_confidence between 0 and 1),
  suggested_action          text,
  created_at                timestamptz not null default now(),
  updated_at                timestamptz not null default now(),
  foreign key (application_id, user_id)
    references public.applications (id, user_id) on delete cascade
);

-- -----------------------------------------------------------------------------
-- send_log (quota)
-- -----------------------------------------------------------------------------
create table public.send_log (
  id             uuid primary key default gen_random_uuid(),
  user_id        uuid not null references auth.users (id) on delete cascade,
  application_id uuid,
  sent_at        timestamptz not null default now(),
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  -- set null: deleting an application must not reset the quota
  foreign key (application_id, user_id)
    references public.applications (id, user_id) on delete set null (application_id)
);

-- -----------------------------------------------------------------------------
-- events (analytics)
-- -----------------------------------------------------------------------------
create table public.events (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references auth.users (id) on delete cascade,
  name       text not null check (char_length(name) between 1 and 100),
  props      jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- -----------------------------------------------------------------------------
-- updated_at triggers (every table)
-- -----------------------------------------------------------------------------
do $$
declare
  t text;
begin
  foreach t in array array[
    'profiles', 'google_connections', 'searches', 'companies', 'leads',
    'contacts', 'applications', 'replies', 'send_log', 'events'
  ]
  loop
    execute format(
      'create trigger set_updated_at before update on public.%I
         for each row execute function public.set_updated_at()', t);
  end loop;
end
$$;

-- -----------------------------------------------------------------------------
-- Indexes
-- (profiles.user_id and google_connections.user_id are covered by their
--  unique constraints.)
-- -----------------------------------------------------------------------------
create unique index companies_siren_key on public.companies (siren);
create index companies_domain_idx on public.companies (domain);

create index searches_user_id_idx on public.searches (user_id);

create index leads_user_id_idx on public.leads (user_id);
create unique index leads_user_id_company_id_key on public.leads (user_id, company_id);
create index leads_search_id_idx on public.leads (search_id);
create index leads_company_id_idx on public.leads (company_id);

create index contacts_user_id_idx on public.contacts (user_id);
create index contacts_lead_id_idx on public.contacts (lead_id);

create index applications_user_id_idx on public.applications (user_id);
create index applications_lead_id_idx on public.applications (lead_id);
create index applications_contact_id_idx on public.applications (contact_id);
create index applications_gmail_thread_id_idx on public.applications (gmail_thread_id);
create index applications_status_next_followup_at_idx
  on public.applications (status, next_followup_at);
create index applications_scheduled_for_idx
  on public.applications (scheduled_for) where status = 'approved';

create index replies_user_id_idx on public.replies (user_id);
create index replies_application_id_idx on public.replies (application_id);
create unique index replies_gmail_message_id_key on public.replies (gmail_message_id);

create index send_log_user_id_sent_at_idx on public.send_log (user_id, sent_at);
create index send_log_application_id_idx on public.send_log (application_id);

create index events_user_id_idx on public.events (user_id);
create index events_name_created_at_idx on public.events (name, created_at);

-- -----------------------------------------------------------------------------
-- Row Level Security
-- -----------------------------------------------------------------------------
alter table public.profiles           enable row level security;
alter table public.google_connections enable row level security;
alter table public.searches           enable row level security;
alter table public.companies          enable row level security;
alter table public.leads              enable row level security;
alter table public.contacts           enable row level security;
alter table public.applications       enable row level security;
alter table public.replies            enable row level security;
alter table public.send_log           enable row level security;
alter table public.events             enable row level security;

-- Full CRUD on own rows for user-owned tables.
do $$
declare
  t text;
begin
  foreach t in array array['profiles', 'searches', 'leads', 'contacts', 'applications']
  loop
    execute format(
      'create policy "%1$s_select_own" on public.%1$I for select to authenticated
         using (user_id = (select auth.uid()))', t);
    execute format(
      'create policy "%1$s_insert_own" on public.%1$I for insert to authenticated
         with check (user_id = (select auth.uid()))', t);
    execute format(
      'create policy "%1$s_update_own" on public.%1$I for update to authenticated
         using (user_id = (select auth.uid()))
         with check (user_id = (select auth.uid()))', t);
    execute format(
      'create policy "%1$s_delete_own" on public.%1$I for delete to authenticated
         using (user_id = (select auth.uid()))', t);
  end loop;
end
$$;

-- replies: read-only for clients (written by the sync cron).
create policy "replies_select_own" on public.replies
  for select to authenticated
  using (user_id = (select auth.uid()));

-- send_log: read-only for clients (written by the server when sending).
create policy "send_log_select_own" on public.send_log
  for select to authenticated
  using (user_id = (select auth.uid()));

-- events: clients may read and insert their own rows.
create policy "events_select_own" on public.events
  for select to authenticated
  using (user_id = (select auth.uid()));
create policy "events_insert_own" on public.events
  for insert to authenticated
  with check (user_id = (select auth.uid()));

-- companies: shared cache, readable by any signed-in user.
create policy "companies_select_authenticated" on public.companies
  for select to authenticated
  using (true);

-- google_connections: intentionally NO policy (service role only).

-- Defense in depth: also strip table privileges that clients must never use,
-- so access stays denied even if a permissive policy is added by mistake.
revoke all on public.google_connections from anon, authenticated;
revoke insert, update, delete, truncate on public.companies from anon, authenticated;
revoke insert, update, delete, truncate on public.replies   from anon, authenticated;
revoke insert, update, delete, truncate on public.send_log  from anon, authenticated;
revoke update, delete, truncate        on public.events    from anon, authenticated;

-- -----------------------------------------------------------------------------
-- google_connection_status view (token-free, own row only)
-- -----------------------------------------------------------------------------
-- This view deliberately runs with the privileges of its OWNER
-- (security_invoker = false, the default): the owner (the migration role,
-- `postgres` on Supabase) bypasses the RLS of google_connections, which has no
-- client policy. Row filtering is therefore done INSIDE the view with
-- `user_id = auth.uid()`, and only non-secret columns are exposed — the
-- encrypted tokens are never selectable by clients.
-- security_barrier prevents user-supplied predicates/functions from being
-- evaluated before the auth.uid() filter (no leakage through side channels).
-- anon gets nothing; authenticated gets SELECT only.
create view public.google_connection_status
with (security_invoker = false, security_barrier = true)
as
select
  gc.user_id,
  gc.google_email,
  gc.scopes,
  gc.status,
  gc.expires_at,
  gc.last_sync_at
from public.google_connections gc
where gc.user_id = (select auth.uid());

revoke all on public.google_connection_status from public, anon, authenticated;
grant select on public.google_connection_status to authenticated, service_role;

comment on view public.google_connection_status is
  'Token-free Gmail connection status of the current user (auth.uid()). '
  'Owner-privileged view (security_invoker = false) over google_connections, '
  'which has no client RLS policy; filtering on auth.uid() is done in the view.';

-- -----------------------------------------------------------------------------
-- Quota helper
-- -----------------------------------------------------------------------------
create or replace function public.sends_in_last_24h(p_user uuid)
returns int
language sql
stable
security definer
set search_path = ''
as $$
  select count(*)::int
  from public.send_log
  where user_id = p_user
    and sent_at > now() - interval '24 hours';
$$;

revoke all on function public.sends_in_last_24h(uuid) from public, anon, authenticated;
grant execute on function public.sends_in_last_24h(uuid) to service_role;

comment on function public.sends_in_last_24h(uuid) is
  'Number of mails sent by a user over the last 24 hours (server quota, SPEC: 20/day). '
  'Callable by service_role only.';

-- -----------------------------------------------------------------------------
-- Auto-create a profile on signup
-- -----------------------------------------------------------------------------
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (user_id, email, full_name)
  values (
    new.id,
    new.email,
    coalesce(new.raw_user_meta_data ->> 'full_name', new.raw_user_meta_data ->> 'name')
  )
  on conflict (user_id) do nothing;
  return new;
end;
$$;

revoke all on function public.handle_new_user() from public, anon, authenticated;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- -----------------------------------------------------------------------------
-- Storage: private bucket `cvs` (PDF, 5 MB max), path `<user_id>/<file>.pdf`
-- -----------------------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('cvs', 'cvs', false, 5242880, array['application/pdf'])
on conflict (id) do update
  set public             = excluded.public,
      file_size_limit    = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

create policy "cvs_select_own" on storage.objects
  for select to authenticated
  using (bucket_id = 'cvs' and (storage.foldername(name))[1] = (select auth.uid())::text);

create policy "cvs_insert_own" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'cvs' and (storage.foldername(name))[1] = (select auth.uid())::text);

create policy "cvs_update_own" on storage.objects
  for update to authenticated
  using (bucket_id = 'cvs' and (storage.foldername(name))[1] = (select auth.uid())::text)
  with check (bucket_id = 'cvs' and (storage.foldername(name))[1] = (select auth.uid())::text);

create policy "cvs_delete_own" on storage.objects
  for delete to authenticated
  using (bucket_id = 'cvs' and (storage.foldername(name))[1] = (select auth.uid())::text);
