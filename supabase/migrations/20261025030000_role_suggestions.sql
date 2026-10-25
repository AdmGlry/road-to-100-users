-- Sprint 1.5 — "Métiers suggérés" (coach d'orientation).
--
-- Stores the last role suggestions generated for the student (prompt
-- `suggest_roles`, lib/profile/roles.ts) so they survive page reloads.
--
-- Non-destructive: two nullable columns, no default rewrite, no data change.
-- RLS: covered by the existing `profiles_*_own` policies (the owner reads and
-- updates their own row). These columns are written by the server action
-- through the user's own session; they are NOT part of the editable profile
-- patch (lib/profile/service.ts saveProfilePatch rejects unknown keys).
--
-- Shape of role_suggestions (validated with Zod when read back):
--   { "promptVersion": text, "generatedAt": text,
--     "roles": [{ "title", "fit", "why"[], "gap", "sectors"[], "alreadyTargeted" }],
--     "questions": [{ "id", "question", "options"[] }],
--     "summary": text,
--     "answers": [{ "question", "answer" }] }

alter table public.profiles
  add column if not exists role_suggestions    jsonb null,
  add column if not exists role_suggestions_at timestamptz null;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'profiles_role_suggestions_is_object') then
    alter table public.profiles
      add constraint profiles_role_suggestions_is_object
      check (role_suggestions is null or jsonb_typeof(role_suggestions) = 'object');
  end if;
end
$$;

comment on column public.profiles.role_suggestions is
  'Last output of prompt suggest_roles (coach d''orientation), validated server side.';
comment on column public.profiles.role_suggestions_at is
  'When role_suggestions was generated.';
