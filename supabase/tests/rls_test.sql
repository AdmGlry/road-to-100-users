-- RLS / integrity tests for the init migration.
-- Run through supabase/tests/run.sh (stub + migration + this file, in one
-- transaction that is rolled back). Every failed assertion raises an
-- exception, which makes psql exit non-zero (ON_ERROR_STOP).

\set ON_ERROR_STOP on
\set QUIET on

\set user_a '''aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'''
\set user_b '''bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'''

-- -----------------------------------------------------------------------------
-- Fixtures (as superuser, i.e. what the service role / server would do)
-- -----------------------------------------------------------------------------
reset role;

insert into auth.users (id, email, raw_user_meta_data) values
  (:user_a, 'a@example.com', '{"full_name": "Alice A"}'),
  (:user_b, 'b@example.com', '{"name": "Bob B"}');

do $$
begin
  if (select count(*) from public.profiles) <> 2 then
    raise exception 'FAIL: signup trigger did not create 2 profiles';
  end if;
  if (select full_name from public.profiles
       where user_id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa') is distinct from 'Alice A' then
    raise exception 'FAIL: profile full_name not copied from raw_user_meta_data';
  end if;
  if (select target_roles from public.profiles
       where user_id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa') <> '{}'::text[] then
    raise exception 'FAIL: profile array defaults';
  end if;
  raise notice 'PASS: profiles auto-created on signup';
end
$$;

insert into public.companies (id, siren, name) values
  ('c0000000-0000-4000-8000-00000000000a', '111111111', 'Acme'),
  ('c0000000-0000-4000-8000-00000000000b', '222222222', 'Globex');

insert into public.searches (id, user_id, params) values
  ('50000000-0000-4000-8000-00000000000a', :user_a, '{}'),
  ('50000000-0000-4000-8000-00000000000b', :user_b, '{}');

insert into public.leads (id, user_id, search_id, company_id, fit_score) values
  ('1e000000-0000-4000-8000-00000000000a', :user_a, '50000000-0000-4000-8000-00000000000a',
   'c0000000-0000-4000-8000-00000000000a', 80),
  ('1e000000-0000-4000-8000-00000000000b', :user_b, '50000000-0000-4000-8000-00000000000b',
   'c0000000-0000-4000-8000-00000000000a', 60);

insert into public.contacts (id, user_id, lead_id, email, source) values
  ('c1000000-0000-4000-8000-00000000000a', :user_a, '1e000000-0000-4000-8000-00000000000a',
   'rh@acme.test', 'generic'),
  ('c1000000-0000-4000-8000-00000000000b', :user_b, '1e000000-0000-4000-8000-00000000000b',
   'jobs@acme.test', 'generic');

insert into public.applications (id, user_id, lead_id, contact_id, subject, body, status) values
  ('a0000000-0000-4000-8000-00000000000a', :user_a, '1e000000-0000-4000-8000-00000000000a',
   'c1000000-0000-4000-8000-00000000000a', 'Candidature A', 'Bonjour', 'sent'),
  ('a0000000-0000-4000-8000-00000000000b', :user_b, '1e000000-0000-4000-8000-00000000000b',
   'c1000000-0000-4000-8000-00000000000b', 'Candidature B', 'Bonjour', 'sent');

insert into public.replies (user_id, application_id, gmail_message_id, received_at, classification) values
  (:user_a, 'a0000000-0000-4000-8000-00000000000a', 'msg-a', now(), 'interview'),
  (:user_b, 'a0000000-0000-4000-8000-00000000000b', 'msg-b', now(), 'rejection');

insert into public.send_log (user_id, application_id) values
  (:user_a, 'a0000000-0000-4000-8000-00000000000a'),
  (:user_b, 'a0000000-0000-4000-8000-00000000000b');

insert into public.events (user_id, name) values (:user_a, 'cv_uploaded'), (:user_b, 'cv_uploaded');

insert into public.google_connections (user_id, google_email, access_token_enc, refresh_token_enc, scopes, status) values
  (:user_a, 'a@gmail.test', 'enc-a', 'enc-ra', '{gmail.send}', 'active'),
  (:user_b, 'b@gmail.test', 'enc-b', 'enc-rb', '{gmail.send}', 'active');

insert into storage.objects (bucket_id, name, owner) values
  ('cvs', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa/cv.pdf', :user_a),
  ('cvs', 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb/cv.pdf', :user_b);

-- Integrity: a contact cannot point at another user's lead (composite FK).
do $$
begin
  begin
    insert into public.contacts (user_id, lead_id, email, source)
    values ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', '1e000000-0000-4000-8000-00000000000b',
            'x@acme.test', 'generic');
    raise exception 'FAIL: cross-user contact -> lead accepted';
  exception when foreign_key_violation then
    raise notice 'PASS: cross-user parent rejected by composite FK';
  end;
end
$$;

-- updated_at trigger
do $$
declare
  after_ts timestamptz;
begin
  update public.companies set updated_at = '2000-01-01' where siren = '222222222';
  select updated_at into after_ts from public.companies where siren = '222222222';
  if after_ts < '2001-01-01' then
    raise exception 'FAIL: set_updated_at trigger did not overwrite updated_at';
  end if;
  raise notice 'PASS: set_updated_at trigger';
end
$$;

-- Bucket
do $$
begin
  if not exists (select 1 from storage.buckets
                 where id = 'cvs' and public = false and file_size_limit = 5242880
                   and allowed_mime_types = array['application/pdf']) then
    raise exception 'FAIL: cvs bucket not configured as expected';
  end if;
  raise notice 'PASS: private cvs bucket';
end
$$;

-- -----------------------------------------------------------------------------
-- As user A (authenticated)
-- -----------------------------------------------------------------------------
set role authenticated;
set request.jwt.claim.sub = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';

do $$
declare
  a constant uuid := 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
  t text;
  n_total int;
  n_own int;
begin
  foreach t in array array['profiles', 'searches', 'leads', 'contacts', 'applications',
                           'replies', 'send_log', 'events']
  loop
    execute format('select count(*), count(*) filter (where user_id = $1) from public.%I', t)
      into n_total, n_own using a;
    if n_total <> 1 or n_own <> 1 then
      raise exception 'FAIL: A sees % rows (% own) in %', n_total, n_own, t;
    end if;
  end loop;
  raise notice 'PASS: A sees only own rows in profiles/searches/leads/contacts/applications/replies/send_log/events';
end
$$;

-- google_connections: no direct access at all
do $$
begin
  begin
    perform 1 from public.google_connections;
    raise exception 'FAIL: A can select google_connections';
  exception when insufficient_privilege then
    raise notice 'PASS: google_connections not selectable by clients';
  end;
end
$$;

-- google_connection_status(): own row only, no token column
do $$
declare
  n int;
begin
  select count(*) into n from public.google_connection_status();
  if n <> 1 then
    raise exception 'FAIL: google_connection_status() returns % rows for A (expected 1)', n;
  end if;
  if (select user_id from public.google_connection_status())
       <> 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' then
    raise exception 'FAIL: google_connection_status() returns another user''s row';
  end if;
  if pg_get_function_result('public.google_connection_status()'::regprocedure) like '%token%' then
    raise exception 'FAIL: google_connection_status() exposes a token column';
  end if;
  raise notice 'PASS: google_connection_status returns own row only, without tokens';
end
$$;

-- send_log: no client writes
do $$
begin
  begin
    insert into public.send_log (user_id) values ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa');
    raise exception 'FAIL: A can insert into send_log';
  exception when insufficient_privilege then
    raise notice 'PASS: A cannot insert into send_log';
  end;
  begin
    delete from public.send_log;
    raise exception 'FAIL: A can delete send_log rows';
  exception when insufficient_privilege then
    raise notice 'PASS: A cannot delete send_log rows';
  end;
end
$$;

-- replies: no client writes
do $$
begin
  begin
    update public.replies set classification = 'other';
    raise exception 'FAIL: A can update replies';
  exception when insufficient_privilege then
    raise notice 'PASS: A cannot update replies';
  end;
end
$$;

-- quota helper is server-only
do $$
begin
  begin
    perform public.sends_in_last_24h('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb');
    raise exception 'FAIL: authenticated can call sends_in_last_24h';
  exception when insufficient_privilege then
    raise notice 'PASS: sends_in_last_24h not callable by clients';
  end;
end
$$;

-- companies: readable, not writable
do $$
begin
  if (select count(*) from public.companies) <> 2 then
    raise exception 'FAIL: authenticated cannot read companies cache';
  end if;
  begin
    insert into public.companies (siren, name) values ('333333333', 'Evil');
    raise exception 'FAIL: A can insert into companies';
  exception when insufficient_privilege then
    raise notice 'PASS: companies readable but not writable by clients';
  end;
end
$$;

-- Own-row CRUD + cannot write rows for B
do $$
begin
  insert into public.searches (user_id, params)
  values ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', '{"city": "Paris"}');
  update public.profiles set city = 'Lyon';
  if (select city from public.profiles) <> 'Lyon' then
    raise exception 'FAIL: A cannot update own profile';
  end if;
  insert into public.events (user_id, name) values ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'search_started');

  begin
    insert into public.events (user_id, name) values ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', 'forged');
    raise exception 'FAIL: A can insert events for B';
  exception when insufficient_privilege then null;
  end;
  begin
    insert into public.searches (user_id) values ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb');
    raise exception 'FAIL: A can insert searches for B';
  exception when insufficient_privilege then null;
  end;
  begin
    update public.applications set user_id = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
    raise exception 'FAIL: A can reassign an application to B';
  exception when insufficient_privilege then null;
  end;
  -- Updating/deleting B's rows silently affects 0 rows
  update public.applications set subject = 'pwned'
   where id = 'a0000000-0000-4000-8000-00000000000b';
  delete from public.leads where id = '1e000000-0000-4000-8000-00000000000b';
  raise notice 'PASS: own-row CRUD works, writes for another user are rejected';
end
$$;

-- Storage: own folder only
do $$
begin
  if (select count(*) from storage.objects) <> 1 then
    raise exception 'FAIL: A sees % storage objects', (select count(*) from storage.objects);
  end if;
  insert into storage.objects (bucket_id, name, owner)
  values ('cvs', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa/cv-v2.pdf', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa');
  begin
    insert into storage.objects (bucket_id, name)
    values ('cvs', 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb/evil.pdf');
    raise exception 'FAIL: A can upload into B''s folder';
  exception when insufficient_privilege then null;
  end;
  raise notice 'PASS: storage cvs objects restricted to own folder';
end
$$;

-- anon sees nothing
reset request.jwt.claim.sub;
set role anon;
do $$
begin
  begin
    perform 1 from public.google_connection_status();
    raise exception 'FAIL: anon can call google_connection_status()';
  exception when insufficient_privilege then null;
  end;
  if (select count(*) from public.applications) <> 0 then
    raise exception 'FAIL: anon sees applications';
  end if;
  raise notice 'PASS: anon has no access';
end
$$;

-- -----------------------------------------------------------------------------
-- Back to superuser: verify B untouched, quota helper, GDPR cascade
-- -----------------------------------------------------------------------------
reset role;

do $$
begin
  if (select subject from public.applications where id = 'a0000000-0000-4000-8000-00000000000b') <> 'Candidature B'
     or not exists (select 1 from public.leads where id = '1e000000-0000-4000-8000-00000000000b') then
    raise exception 'FAIL: A modified B''s data';
  end if;
  raise notice 'PASS: B''s data untouched by A';
end
$$;

set role service_role;
do $$
begin
  if public.sends_in_last_24h('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa') <> 1 then
    raise exception 'FAIL: sends_in_last_24h wrong count';
  end if;
  raise notice 'PASS: sends_in_last_24h callable by service_role';
end
$$;
reset role;

-- Deleting an application keeps the send_log row (quota not reset).
do $$
begin
  delete from public.applications where id = 'a0000000-0000-4000-8000-00000000000b';
  if public.sends_in_last_24h('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb') <> 1 then
    raise exception 'FAIL: deleting an application reset the quota';
  end if;
  if exists (select 1 from public.replies where gmail_message_id = 'msg-b') then
    raise exception 'FAIL: replies not cascaded with application';
  end if;
  raise notice 'PASS: application delete cascades replies and keeps send_log';
end
$$;

-- -----------------------------------------------------------------------------
-- Sprint 2 (20261025020000_hunter_search.sql): new lead / search columns
-- -----------------------------------------------------------------------------
do $$
begin
  if (select progress from public.searches
       where id = '50000000-0000-4000-8000-00000000000a') <> '{}'::jsonb then
    raise exception 'FAIL: searches.progress default';
  end if;
  begin
    update public.searches set progress = '[]'::jsonb
     where id = '50000000-0000-4000-8000-00000000000a';
    raise exception 'FAIL: non-object searches.progress accepted';
  exception when check_violation then null;
  end;
  begin
    update public.leads set prefilter_score = 101
     where id = '1e000000-0000-4000-8000-00000000000a';
    raise exception 'FAIL: prefilter_score > 100 accepted';
  exception when check_violation then null;
  end;
  raise notice 'PASS: hunter columns defaults and checks';
end
$$;

set role authenticated;
set request.jwt.claim.sub = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';

do $$
declare
  n int;
begin
  -- Progress / error updates on own search (what runSearch does with the user client).
  update public.searches
     set progress = '{"step": "scoring", "done": 1, "total": 6}', error = null
   where id = '50000000-0000-4000-8000-00000000000a';
  if (select progress ->> 'step' from public.searches
       where id = '50000000-0000-4000-8000-00000000000a') <> 'scoring' then
    raise exception 'FAIL: A cannot update own search progress';
  end if;

  -- Lead upsert on (user_id, company_id): updates the existing row, keeps its status.
  update public.leads set status = 'selected' where id = '1e000000-0000-4000-8000-00000000000a';
  insert into public.leads (user_id, search_id, company_id, fit_score, prefilter_score,
                            distance_km, establishment_city)
  values ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', '50000000-0000-4000-8000-00000000000a',
          'c0000000-0000-4000-8000-00000000000a', 91, 70, 3.2, 'NANTES')
  on conflict (user_id, company_id) do update
    set fit_score = excluded.fit_score, prefilter_score = excluded.prefilter_score,
        distance_km = excluded.distance_km, establishment_city = excluded.establishment_city;
  select count(*) into n from public.leads;
  if n <> 1 then
    raise exception 'FAIL: lead upsert duplicated rows (% leads)', n;
  end if;
  if (select status from public.leads) <> 'selected'
     or (select fit_score from public.leads) <> 91
     or (select establishment_city from public.leads) <> 'NANTES' then
    raise exception 'FAIL: lead upsert did not merge as expected';
  end if;

  -- Still cannot touch B's search.
  update public.searches set error = 'pwned' where id = '50000000-0000-4000-8000-00000000000b';
  raise notice 'PASS: A updates own search progress and upserts own leads without duplicates';
end
$$;

reset request.jwt.claim.sub;
reset role;

do $$
begin
  if (select error from public.searches where id = '50000000-0000-4000-8000-00000000000b')
     is not null then
    raise exception 'FAIL: A modified B''s search';
  end if;
  raise notice 'PASS: B''s search untouched';
end
$$;

-- -----------------------------------------------------------------------------
-- Sprint 3: atomic send quota (reserve_send_slot) + one application per lead
-- -----------------------------------------------------------------------------
reset role;

do $$
declare
  b constant uuid := 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
  used int;
  slot uuid;
begin
  -- Seed sends are 1 h old (outside the 30 s spacing window, inside the 24 h quota).
  update public.send_log set sent_at = now() - interval '1 hour' where user_id = b;
  select count(*) into used from public.send_log
   where user_id = b and sent_at > now() - interval '24 hours';
  slot := public.reserve_send_slot(b, null, used + 1);
  if slot is null then
    raise exception 'FAIL: reserve_send_slot refused a slot under the limit';
  end if;
  if public.reserve_send_slot(b, null, used + 1) is not null then
    raise exception 'FAIL: reserve_send_slot exceeded the limit';
  end if;
  -- Releasing the slot (failed send) frees the quota again.
  delete from public.send_log where id = slot;
  -- Spacing: a second send less than 30 s after the previous one is refused.
  delete from public.send_log where user_id = b and sent_at > now() - interval '1 minute';
  if public.reserve_send_slot(b, null, used + 5) is null then
    raise exception 'FAIL: reserve_send_slot refused a slot under the limit';
  end if;
  begin
    perform public.reserve_send_slot(b, null, used + 5);
    raise exception 'FAIL: two sends less than 30 s apart';
  exception when raise_exception then
    if sqlerrm <> 'send_too_soon' then raise; end if;
  end;
  delete from public.send_log where user_id = b and sent_at > now() - interval '1 minute';
  if public.reserve_send_slot(b, null, used + 1) is null then
    raise exception 'FAIL: released slot not available again';
  end if;
  raise notice 'PASS: reserve_send_slot enforces the rolling quota';
end
$$;

set role authenticated;
set request.jwt.claim.sub = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
do $$
begin
  begin
    perform public.reserve_send_slot('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', null, 1000);
    raise exception 'FAIL: authenticated may call reserve_send_slot';
  exception when insufficient_privilege then
    raise notice 'PASS: reserve_send_slot is service-role only';
  end;
  begin
    perform public.trigger_send_queue();
    raise exception 'FAIL: authenticated may call trigger_send_queue';
  exception when insufficient_privilege then
    raise notice 'PASS: trigger_send_queue is not callable by clients';
  end;
end
$$;
reset request.jwt.claim.sub;
reset role;

do $$
declare
  lead_b uuid;
begin
  select id into lead_b from public.leads
   where user_id = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb' limit 1;
  if not exists (select 1 from public.applications where lead_id = lead_b) then
    insert into public.applications (user_id, lead_id)
    values ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', lead_b);
  end if;
  begin
    insert into public.applications (user_id, lead_id)
    values ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', lead_b);
    raise exception 'FAIL: two applications for the same lead';
  exception when unique_violation then
    raise notice 'PASS: one application per lead';
  end;
  -- trigger_send_queue is a no-op without vault / pg_net (must not fail).
  perform public.trigger_send_queue();
  raise notice 'PASS: trigger_send_queue no-op without vault';
end
$$;

-- Clients may only move their applications between draft and approved;
-- worker-owned columns and sent mails are read-only (service role exempt).
set role authenticated;
set request.jwt.claim.sub = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
do $$
declare
  app_b uuid;
begin
  select a.id into app_b from public.applications a
   where a.status = 'draft' limit 1;
  update public.applications set subject = 'Objet', body = 'Bonjour', contact_id = null
   where id = app_b;
  update public.applications set status = 'approved', approved_at = now() where id = app_b;
  begin
    update public.applications set scheduled_for = now() where id = app_b;
    raise exception 'FAIL: client queued a mail without recipient';
  exception when insufficient_privilege then null;
  end;
  update public.applications set contact_id = 'c1000000-0000-4000-8000-00000000000b'
   where id = app_b;
  update public.applications set scheduled_for = now() where id = app_b;
  if (select scheduled_for from public.applications where id = app_b) is null then
    raise exception 'FAIL: client cannot queue a validated mail';
  end if;
  begin
    update public.applications set send_claimed_at = now() where id = app_b;
    raise exception 'FAIL: client set send_claimed_at';
  exception when insufficient_privilege then null;
  end;
  begin
    update public.applications set status = 'sent', sent_at = now() where id = app_b;
    raise exception 'FAIL: client marked a mail as sent';
  exception when insufficient_privilege then null;
  end;
  begin
    update public.applications set gmail_thread_id = 'x' where id = app_b;
    raise exception 'FAIL: client set gmail_thread_id';
  exception when insufficient_privilege then null;
  end;
  begin
    update public.applications set followup_status = 'draft', followup_body = 'x' where id = app_b;
    raise exception 'FAIL: client wrote a follow-up';
  exception when insufficient_privilege then null;
  end;
  begin
    insert into public.applications (user_id, lead_id, status, approved_at, scheduled_for)
    select 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', l.id, 'approved', now(), now()
      from public.leads l limit 1;
    raise exception 'FAIL: client inserted a queued mail';
  exception when insufficient_privilege then null;
  end;
  update public.applications set scheduled_for = null where id = app_b;
  raise notice 'PASS: client writes on applications limited to draft/approved';
end
$$;
reset request.jwt.claim.sub;
set role service_role;
do $$
begin
  update public.applications set send_claimed_at = now()
   where user_id = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb' and status = 'approved';
  update public.applications set send_claimed_at = null
   where user_id = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb' and status = 'approved';
  update public.applications set status = 'sent', sent_at = now(), scheduled_for = null
   where user_id = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb' and status = 'approved';
  raise notice 'PASS: service role not restricted by the client guard';
end
$$;
set role authenticated;
set request.jwt.claim.sub = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
do $$
begin
  if not exists (select 1 from public.applications where status = 'sent') then
    raise exception 'FAIL: no sent application to test';
  end if;
  begin
    update public.applications set subject = 'pwned', status = 'draft' where status = 'sent';
    raise exception 'FAIL: client edited a sent mail';
  exception when insufficient_privilege then null;
  end;
  raise notice 'PASS: sent mails are read-only for clients';
end
$$;
reset request.jwt.claim.sub;
reset role;

-- Sprint 4: cron ping helper (no-op without vault, path validated, cron only).
do $$
begin
  perform public.trigger_cron_endpoint('/api/cron/sync-replies');
  begin
    perform public.trigger_cron_endpoint('https://evil.example/x');
    raise exception 'FAIL: trigger_cron_endpoint accepted an arbitrary URL';
  exception when raise_exception then
    if sqlerrm like 'FAIL:%' then raise; end if;
  end;
  if (select followup_status from public.applications limit 1) is not null then
    raise exception 'FAIL: followup_status should default to null';
  end if;
  raise notice 'PASS: trigger_cron_endpoint no-op without vault and path checked';
end
$$;
set role authenticated;
set request.jwt.claim.sub = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
do $$
begin
  begin
    perform public.trigger_cron_endpoint('/api/cron/sync-replies');
    raise exception 'FAIL: authenticated may call trigger_cron_endpoint';
  exception when insufficient_privilege then
    raise notice 'PASS: trigger_cron_endpoint is not callable by clients';
  end;
end
$$;
reset request.jwt.claim.sub;
reset role;

-- GDPR: deleting auth user A removes ALL of A's rows.
delete from auth.users where id = :user_a;

do $$
declare
  a constant uuid := 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
  t text;
  n int;
begin
  foreach t in array array['profiles', 'google_connections', 'searches', 'leads', 'contacts',
                           'applications', 'replies', 'send_log', 'events']
  loop
    execute format('select count(*) from public.%I where user_id = $1', t) into n using a;
    if n <> 0 then
      raise exception 'FAIL: % rows of A left in % after user deletion', n, t;
    end if;
  end loop;
  if (select count(*) from public.profiles) <> 1 or (select count(*) from public.google_connections) <> 1 then
    raise exception 'FAIL: B''s rows were deleted with A';
  end if;
  if (select count(*) from public.companies) <> 2 then
    raise exception 'FAIL: shared companies cache affected by user deletion';
  end if;
  raise notice 'PASS: deleting auth user A cascades all A rows, B and shared cache intact';
end
$$;

\echo 'ALL RLS TESTS PASSED'
