-- Personal OS - Calendar v2, phase 1: base model
--   block_types       the block as a concept. Its name is its identity (unique per user).
--   block_slots       one weekly slot of a block type (weekday + start/end + validity range).
--   block_occurrences what really happens on a date. History lives here, so editing the
--                     weekly pattern never rewrites the past.
-- Also copies the current time_blocks into the new tables (time_blocks is kept, untouched,
-- as a backup; the app stops writing to it).
-- Requires 0006 to be applied first. Safe to run twice.

do $$ begin
  create type block_occurrence_status as enum ('scheduled', 'done', 'partial', 'free_day', 'cancelled');
exception when duplicate_object then null; end $$;

-- ---------- block_types -------------------------------------------------
create table if not exists public.block_types (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null default auth.uid() references auth.users(id) on delete cascade,
  name        text not null check (length(trim(name)) > 0),
  color       text not null default '#6366f1',
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  deleted_at  timestamptz
);
create unique index if not exists block_types_user_name_uq
  on public.block_types (user_id, lower(name)) where deleted_at is null;

-- ---------- block_slots -------------------------------------------------
-- weekday is ISO: 1 = Monday ... 7 = Sunday.
-- end_time < start_time means the slot ends the next day (e.g. 23:00 -> 01:00).
-- Changing a slot "from today on" closes it (valid_to = yesterday) and opens a new one.
create table if not exists public.block_slots (
  id                    uuid primary key default gen_random_uuid(),
  user_id               uuid not null default auth.uid() references auth.users(id) on delete cascade,
  block_type_id         uuid not null references public.block_types(id) on delete cascade,
  weekday               smallint not null check (weekday between 1 and 7),
  start_time            time not null,
  end_time              time not null,
  valid_from            date not null default current_date,
  valid_to              date,
  legacy_time_block_id  uuid references public.time_blocks(id) on delete set null,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),
  deleted_at            timestamptz,
  check (end_time <> start_time),
  check (valid_to is null or valid_to >= valid_from)
);
create index if not exists block_slots_user_weekday_idx
  on public.block_slots (user_id, weekday) where deleted_at is null;

-- ---------- block_occurrences -------------------------------------------
-- Created on demand by the app for the dates it shows (and at the end of each day).
-- origin_date = the date the slot generated it for; date = where it really is (it can be
-- moved "this day only"). A slot generates at most one occurrence per origin_date.
-- slot_id null = a one-off ("this day only" block, or a moved copy whose slot is gone).
-- Removing a block for one day sets status = 'cancelled' (the row stays, so it is not regenerated).
create table if not exists public.block_occurrences (
  id             uuid primary key default gen_random_uuid(),
  user_id        uuid not null default auth.uid() references auth.users(id) on delete cascade,
  block_type_id  uuid not null references public.block_types(id) on delete cascade,
  slot_id        uuid references public.block_slots(id) on delete set null,
  origin_date    date,
  date           date not null,
  start_time     time not null,
  end_time       time not null,
  status         block_occurrence_status not null default 'scheduled',
  is_override    boolean not null default false,   -- edited "this day only"
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  check (end_time <> start_time),
  constraint block_occurrences_slot_origin_uq unique (slot_id, origin_date)
);
create index if not exists block_occurrences_user_date_idx on public.block_occurrences (user_id, date);
create index if not exists block_occurrences_type_date_idx on public.block_occurrences (block_type_id, date);

-- ---------- updated_at + RLS --------------------------------------------
do $$
declare t text;
begin
  foreach t in array array['block_types', 'block_slots', 'block_occurrences'] loop
    execute format('drop trigger if exists %I on public.%I', t || '_updated_at', t);
    execute format('create trigger %I before update on public.%I
                    for each row execute function public.set_updated_at()', t || '_updated_at', t);
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists "own rows" on public.%I', t);
    execute format('create policy "own rows" on public.%I for all to authenticated
                    using (user_id = (select auth.uid()))
                    with check (user_id = (select auth.uid()))', t);
  end loop;
end $$;

-- ---------- Links: notes can point at a block type -----------------------
create or replace function public.entity_exists(p_type entity_type, p_id uuid, p_user uuid)
returns boolean language plpgsql stable security definer set search_path = public as $$
declare found boolean;
begin
  execute format('select exists(select 1 from public.%I where id = $1 and user_id = $2)',
                 case p_type::text when 'time_block' then 'time_blocks'
                                   when 'event'      then 'events'
                                   when 'task'       then 'tasks'
                                   when 'note'       then 'notes'
                                   when 'block_type' then 'block_types' end)
    into found using p_id, p_user;
  return found;
end $$;

-- ---------- Copy the current time_blocks into the new model --------------
do $$
declare
  b       record;
  bt      uuid;
  d       text;
  wd      smallint;
  days    text[];
  iso     constant text[] := array['MO','TU','WE','TH','FR','SA','SU'];
begin
  for b in
    select * from public.time_blocks where deleted_at is null order by created_at
  loop
    if exists (select 1 from public.block_slots where legacy_time_block_id = b.id) then
      continue;  -- already copied
    end if;

    -- Same name (ignoring case) = same block type
    select id into bt from public.block_types
     where user_id = b.user_id and lower(name) = lower(trim(b.title)) and deleted_at is null
     limit 1;
    if bt is null then
      insert into public.block_types (user_id, name, color)
      values (b.user_id, trim(b.title), coalesce(nullif(b.color, ''), '#6366f1'))
      returning id into bt;
    end if;

    if upper(b.rrule) like 'FREQ=DAILY%' then
      days := iso;
    else
      days := string_to_array(upper(split_part(split_part(b.rrule, 'BYDAY=', 2), ';', 1)), ',');
    end if;

    foreach d in array coalesce(days, array[]::text[]) loop
      wd := array_position(iso, trim(d));
      if wd is not null then
        insert into public.block_slots
          (user_id, block_type_id, weekday, start_time, end_time, valid_from, valid_to, legacy_time_block_id)
        values
          (b.user_id, bt, wd, b.start_time, b.end_time, b.valid_from, b.valid_until, b.id);
      end if;
    end loop;
  end loop;
end $$;

-- Notes that were linked to an old time block now point at its block type too
insert into public.entity_relations (user_id, source_type, source_id, target_type, target_id, relationship_type)
select distinct r.user_id, r.source_type, r.source_id, 'block_type'::entity_type, s.block_type_id, r.relationship_type
  from public.entity_relations r
  join public.block_slots s on s.legacy_time_block_id = r.target_id
 where r.target_type = 'time_block' and r.source_type = 'note' and r.deleted_at is null
on conflict do nothing;
