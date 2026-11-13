-- Personal OS - 0059: the phone answers back.
-- 1) alarm_events: every ring and every answer from the Android app (Started, Skip today, Done, ticks, check-in...).
--    client_id comes from the phone, so a retry after a lost connection never counts twice.
-- 2) daily_facts.sleep_quality (1-5), asked in the morning check-in. Typed by you, never overwritten by a refresh.
-- 3) user_settings.alarm_last_sync_at: when the phone last read its alarms (Telegram warns if it goes quiet).
-- Additive and safe to run twice.

create table if not exists public.alarm_events (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references auth.users(id) on delete cascade,
  client_id     text not null,
  kind          text not null check (kind in ('rang', 'answer', 'checkin', 'tick', 'sleep')),
  answer        text,
  occurrence_id uuid references public.block_occurrences(id) on delete set null,
  block_type_id uuid references public.block_types(id) on delete set null,
  chain         text,
  seq           smallint,
  total         smallint,
  anchor        text,
  style         text,
  at            timestamptz not null,
  alarm_at      timestamptz,
  detail        jsonb,
  created_at    timestamptz not null default now(),
  unique (user_id, client_id)
);
create index if not exists alarm_events_user_at_idx on public.alarm_events (user_id, at desc);
alter table public.alarm_events enable row level security;
drop policy if exists "own alarm events read" on public.alarm_events;
create policy "own alarm events read" on public.alarm_events for select to authenticated using (user_id = (select auth.uid()));

alter table public.daily_facts add column if not exists sleep_quality smallint check (sleep_quality between 1 and 5);
grant update (sleep_quality) on public.daily_facts to authenticated;

alter table public.user_settings add column if not exists alarm_last_sync_at timestamptz;
