-- =============================================================================
-- Company careers / contact pages (SPEC §7.4, Sprint 5): found with the official
-- website (Context.dev brand lookup), shown on the review screen so the student
-- can use the company's own spontaneous-application form when it has one.
-- Public company information in the shared `companies` cache (no personal data).
-- NON-DESTRUCTIVE: nullable columns only.
-- =============================================================================

alter table public.companies
  add column if not exists careers_url text,
  add column if not exists contact_url text;

comment on column public.companies.careers_url is
  'Careers / recruiting page on the official domain (https), null when unknown.';
comment on column public.companies.contact_url is
  'Contact page on the official domain (https), null when unknown.';
