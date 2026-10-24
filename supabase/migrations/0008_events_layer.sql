-- Personal OS - Calendar v2, phase 3: events are their own layer.
--   * every event has a local date (event_date .. end_date); start/end time are optional
--     (an event without time is metadata of the day, e.g. "Hotel in Lima")
--   * event types with their own editable color
-- Safe to run twice.

-- ---------- event_types -------------------------------------------------
create table if not exists public.event_types (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null default auth.uid() references auth.users(id) on delete cascade,
  name        text not null check (length(trim(name)) > 0),
  color       text not null default '#64748b',
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  deleted_at  timestamptz
);
create unique index if not exists event_types_user_name_uq
  on public.event_types (user_id, lower(name)) where deleted_at is null;

drop trigger if exists event_types_updated_at on public.event_types;
create trigger event_types_updated_at before update on public.event_types
  for each row execute function public.set_updated_at();
alter table public.event_types enable row level security;
drop policy if exists "own rows" on public.event_types;
create policy "own rows" on public.event_types for all to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));

-- ---------- events: dates, optional time, type ----------------------------
alter table public.events
  add column if not exists event_date     date,
  add column if not exists end_date       date,
  add column if not exists event_type_id  uuid references public.event_types(id) on delete set null;

alter table public.events alter column start_time drop not null;
alter table public.events alter column end_time drop not null;

-- Backfill local dates from the existing times (in each user's timezone)
update public.events e
   set event_date = (e.start_time at time zone coalesce(s.timezone, 'America/Guayaquil'))::date,
       end_date   = ((e.end_time - interval '1 second') at time zone coalesce(s.timezone, 'America/Guayaquil'))::date
  from public.user_settings s
 where s.user_id = e.user_id and e.event_date is null and e.start_time is not null;
update public.events set event_date = coalesce(event_date, current_date) where event_date is null;
update public.events set end_date = event_date where end_date is null or end_date < event_date;

-- Anything that inserts an event without dates (imports, older code) gets them filled in
create or replace function public.events_fill_dates()
returns trigger language plpgsql set search_path = public as $$
declare tz text;
begin
  if new.event_date is null or new.end_date is null then
    select timezone into tz from public.user_settings where user_id = new.user_id;
    tz := coalesce(tz, 'America/Guayaquil');
    if new.event_date is null then
      new.event_date := coalesce((new.start_time at time zone tz)::date, (now() at time zone tz)::date);
    end if;
    if new.end_date is null then
      new.end_date := coalesce(((new.end_time - interval '1 second') at time zone tz)::date, new.event_date);
    end if;
  end if;
  if new.end_date < new.event_date then
    new.end_date := new.event_date;
  end if;
  return new;
end $$;

drop trigger if exists events_fill_dates on public.events;
create trigger events_fill_dates before insert or update on public.events
  for each row execute function public.events_fill_dates();

alter table public.events alter column event_date set not null;
alter table public.events alter column end_date set not null;

do $$ begin
  alter table public.events add constraint events_time_both_or_none
    check ((start_time is null) = (end_time is null));
exception when duplicate_object then null; end $$;

create index if not exists events_user_dates_idx on public.events (user_id, event_date, end_date) where deleted_at is null;
