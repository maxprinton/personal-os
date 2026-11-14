-- Personal OS - 0067: customisable nags for calendar events (BL-98).
-- A nag is a Telegram message and/or a phone alarm before, at the start, or in the middle of an event.
-- event_id null = the default set (all events). An event with nags_custom = true uses only its own rows
-- (an empty list = no nags for that event). Additive and safe to run twice.

create table if not exists public.event_nags (
  id              uuid primary key default gen_random_uuid(),
  user_id         uuid not null default auth.uid() references auth.users(id) on delete cascade,
  event_id        uuid references public.events(id) on delete cascade,
  kind            text not null check (kind in ('before', 'start', 'mid')),
  offset_minutes  integer not null default 0 check (offset_minutes between 0 and 86400),
  channel         text not null default 'telegram' check (channel in ('telegram', 'phone', 'both')),
  phone_style     text not null default 'alarm' check (phone_style in ('alarm', 'notify')),
  created_at      timestamptz not null default now(),
  check (kind = 'before' or offset_minutes = 0),
  check (kind <> 'before' or offset_minutes >= 1)
);
create index if not exists event_nags_user_idx on public.event_nags (user_id, event_id);

alter table public.event_nags enable row level security;
drop policy if exists "own rows" on public.event_nags;
create policy "own rows" on public.event_nags for all to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));

alter table public.events add column if not exists nags_custom boolean not null default false;
alter table public.user_settings add column if not exists nag_allday_time time not null default '09:00';
