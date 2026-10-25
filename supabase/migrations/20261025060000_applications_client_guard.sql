-- Sprint 3 hardening: students may only move their own applications between
-- draft and approved (edit, validate, queue). Everything the send worker owns
-- (claim, sent_at, Gmail ids) and sent mails are read-only for clients, so the
-- REST API cannot be used to skip the review rules or re-send a mail.
-- The service role (server actions on the admin client, cron) is not affected.
-- Non-destructive: function + trigger only.

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
       or new.gmail_thread_id is not null then
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
     or (new.approved_at is not null and new.status <> 'approved')
     or (new.scheduled_for is not null
         and (new.status <> 'approved' or new.approved_at is null or new.contact_id is null)) then
    raise exception 'applications: forbidden client update' using errcode = '42501';
  end if;
  return new;
end;
$$;

revoke all on function public.applications_guard_client_write() from public, anon, authenticated;

do $$
begin
  if not exists (
    select 1 from pg_trigger
     where tgname = 'applications_guard_client_write'
       and tgrelid = 'public.applications'::regclass
  ) then
    create trigger applications_guard_client_write
      before insert or update on public.applications
      for each row execute function public.applications_guard_client_write();
  end if;
end
$$;
