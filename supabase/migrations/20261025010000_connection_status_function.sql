-- Replace the owner-privileged view `google_connection_status` with an
-- equivalent SECURITY DEFINER function. Same guarantees (own row only, no
-- token columns), but it no longer trips Supabase's `security_definer_view`
-- linter (ERROR level), so real security advisories stay visible.
--
-- Usage from the app: supabase.rpc('google_connection_status')
--
-- The view is neutralised (security_invoker: clients have no privilege on
-- google_connections, so it returns nothing to them) rather than dropped, so
-- this migration is non-destructive. It is no longer used by the app.

alter view public.google_connection_status set (security_invoker = true);
revoke all on public.google_connection_status from authenticated;

create or replace function public.google_connection_status()
returns table (
  user_id      uuid,
  google_email text,
  scopes       text[],
  status       public.google_connection_state,
  expires_at   timestamptz,
  last_sync_at timestamptz
)
language sql
stable
security definer
set search_path = ''
as $$
  select gc.user_id, gc.google_email, gc.scopes, gc.status, gc.expires_at, gc.last_sync_at
  from public.google_connections gc
  where gc.user_id = (select auth.uid());
$$;

revoke all on function public.google_connection_status() from public, anon, authenticated;
grant execute on function public.google_connection_status() to authenticated, service_role;

comment on function public.google_connection_status() is
  'Token-free Gmail connection status of the current user (auth.uid()). '
  'Security definer over google_connections, which has no client RLS policy.';
