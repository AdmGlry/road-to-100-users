-- TEST-ONLY: minimal stub of the Supabase environment so that the migrations
-- can be run against a vanilla PostgreSQL 16 database.
-- Never run this against a real Supabase project.

-- Roles (Supabase: service_role bypasses RLS, anon/authenticated do not).
do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then
    create role anon nologin noinherit;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then
    create role authenticated nologin noinherit;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'service_role') then
    create role service_role nologin noinherit bypassrls;
  end if;
end
$$;

create schema if not exists auth;
create schema if not exists storage;

grant usage on schema public, auth, storage to anon, authenticated, service_role;

-- Mimic Supabase's default privileges: every new table/function in public is
-- granted to anon/authenticated/service_role, so RLS is the real barrier.
alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;
alter default privileges in schema public grant all on functions to anon, authenticated, service_role;

-- auth.users
create table if not exists auth.users (
  id uuid primary key,
  email text,
  raw_user_meta_data jsonb
);

create or replace function auth.uid()
returns uuid
language sql
stable
as $$
  select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
$$;

grant execute on function auth.uid() to anon, authenticated, service_role;

-- storage
create table if not exists storage.buckets (
  id text primary key,
  name text,
  public bool,
  file_size_limit bigint,
  allowed_mime_types text[]
);

create table if not exists storage.objects (
  id uuid default gen_random_uuid() primary key,
  bucket_id text,
  name text,
  owner uuid
);

create or replace function storage.foldername(name text)
returns text[]
language sql
immutable
as $$
  select string_to_array(name, '/')
$$;

alter table storage.objects enable row level security;

grant select on storage.buckets to anon, authenticated, service_role;
grant all on storage.objects to authenticated, service_role;
grant execute on function storage.foldername(text) to anon, authenticated, service_role;
