-- =============================================================================
-- Sprint 2 — Chasseur : recherche et scoring (SPEC §7.1–7.3)
-- =============================================================================
-- NON-DESTRUCTIVE: only adds nullable / defaulted columns and indexes.
--
-- leads: the establishment that matched the search (the company HQ can be far
-- away, e.g. a large group headquartered in Paris with a Nantes office), its
-- distance from the student's city, and the deterministic pre-filter score.
-- searches: live progress shown in the UI and a user-safe (French) error.
-- companies.headcount_range stores the INSEE "tranche d'effectif" code
-- (e.g. '12' = 20 à 49 salariés); labels are computed in lib/hunter/headcount.ts.
-- =============================================================================

alter table public.leads
  add column if not exists distance_km           double precision,
  add column if not exists establishment_siret   text,
  add column if not exists establishment_address text,
  add column if not exists establishment_city    text,
  add column if not exists establishment_lat     double precision,
  add column if not exists establishment_lng     double precision,
  add column if not exists prefilter_score       int;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'leads_prefilter_score_check') then
    alter table public.leads
      add constraint leads_prefilter_score_check check (prefilter_score between 0 and 100);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'leads_distance_km_check') then
    alter table public.leads
      add constraint leads_distance_km_check check (distance_km >= 0);
  end if;
end
$$;

alter table public.searches
  add column if not exists progress jsonb not null default '{}'::jsonb,
  add column if not exists error    text;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'searches_progress_object_check') then
    alter table public.searches
      add constraint searches_progress_object_check check (jsonb_typeof(progress) = 'object');
  end if;
end
$$;

-- Lead cards of a search, best score first (listLeads).
create index if not exists leads_search_id_fit_score_idx
  on public.leads (search_id, fit_score desc);

-- Latest searches of a user.
create index if not exists searches_user_id_created_at_idx
  on public.searches (user_id, created_at desc);

comment on column public.leads.distance_km is
  'Distance (km) between the student''s city and the matching establishment.';
comment on column public.leads.prefilter_score is
  'Deterministic pre-filter score 0-100 (distance, size, NAF priority), lib/hunter/prefilter.ts.';
comment on column public.searches.progress is
  '{"step": "naf"|"fetch"|"prefilter"|"scoring"|"done", "done": n, "total": m}';
comment on column public.searches.error is 'User-safe error message (French) when status = failed.';
comment on column public.companies.headcount_range is
  'INSEE tranche d''effectif salarié code (e.g. ''12'' = 20 à 49 salariés); null if unknown.';
