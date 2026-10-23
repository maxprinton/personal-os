-- Personal OS - Telegram reminders
-- Preferences per user, a log so nothing is sent twice, and a job that wakes the app every 5 minutes.

alter table public.user_settings
  add column if not exists reminder_morning_enabled boolean not null default true,
  add column if not exists reminder_morning_time time not null default '07:00',
  add column if not exists reminder_evening_enabled boolean not null default true,
  add column if not exists reminder_evening_time time not null default '21:00',
  add column if not exists reminder_before_minutes integer not null default 10
    check (reminder_before_minutes between 0 and 120),
  add column if not exists reminder_insights boolean not null default true;

-- One row per reminder actually sent (kind + ref is unique per user)
create table if not exists public.reminder_log (
  id        uuid primary key default gen_random_uuid(),
  user_id   uuid not null references auth.users(id) on delete cascade,
  kind      text not null,          -- morning | before | evening | insights
  ref       text not null,          -- e.g. 2026-10-24 or event:<id>:2026-10-24
  sent_at   timestamptz not null default now(),
  unique (user_id, kind, ref)
);
alter table public.reminder_log enable row level security;
drop policy if exists "own rows" on public.reminder_log;
create policy "own rows" on public.reminder_log for select to authenticated
  using (user_id = (select auth.uid()));

-- Shared secret between the database job and the app (no policies: only the server key can read it)
create table if not exists public.cron_secrets (
  name       text primary key,
  secret     text not null,
  created_at timestamptz not null default now()
);
alter table public.cron_secrets enable row level security;
revoke all on public.cron_secrets from anon, authenticated;
insert into public.cron_secrets (name, secret)
values ('reminders', replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', ''))
on conflict (name) do nothing;
