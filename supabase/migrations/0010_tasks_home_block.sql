-- Personal OS - Calendar v2, phase 5: tasks with a home block + morning ritual.
--   tasks.home_block_type_id  the block a task belongs to (e.g. "Work")
--   tasks.occurrence_id       the block appearance it is placed in today (one linked task:
--                             it shows in every appearance of that block on that day)
--   tasks.event_id            placed in an event (an event with tasks acts like a block for them)
--   tasks.rolled_over_count   is now the "moved" counter: +1 each time the day ends with the task
--                             undone, +1 per manual move to another day (auto-placement doesn't count)
--   task_day_log              what happened to a task on a day it was not done (skipped / moved),
--                             so its original day keeps showing it
-- Nothing moves silently any more: the old hourly "migrate" rollover is turned off for
-- migrate tasks (the morning ritual handles them). Backlog / graveyard policies keep working.
-- Requires 0007 and 0008. Safe to run twice.

alter table public.tasks
  add column if not exists home_block_type_id uuid references public.block_types(id) on delete set null,
  add column if not exists occurrence_id uuid references public.block_occurrences(id) on delete set null,
  add column if not exists event_id uuid references public.events(id) on delete set null;
create index if not exists tasks_occurrence_idx on public.tasks (occurrence_id) where deleted_at is null;
create index if not exists tasks_event_idx on public.tasks (event_id) where deleted_at is null;

create table if not exists public.task_day_log (
  id             uuid primary key default gen_random_uuid(),
  user_id        uuid not null default auth.uid() references auth.users(id) on delete cascade,
  task_id        uuid not null references public.tasks(id) on delete cascade,
  date           date not null,
  outcome        text not null check (outcome in ('skipped', 'moved')),
  occurrence_id  uuid references public.block_occurrences(id) on delete set null,
  event_id       uuid references public.events(id) on delete set null,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  constraint task_day_log_task_date_uq unique (task_id, date)
);
create index if not exists task_day_log_user_date_idx on public.task_day_log (user_id, date);

drop trigger if exists task_day_log_updated_at on public.task_day_log;
create trigger task_day_log_updated_at before update on public.task_day_log
  for each row execute function public.set_updated_at();
alter table public.task_day_log enable row level security;
drop policy if exists "own rows" on public.task_day_log;
create policy "own rows" on public.task_day_log for all to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));

alter table public.user_settings
  add column if not exists ritual_seen_on date,
  add column if not exists reminder_unassigned_nag boolean not null default true;

-- Tasks that were linked to an old time block get its block type as their home block
update public.tasks t
   set home_block_type_id = s.block_type_id
  from public.entity_relations r
  join public.block_slots s on s.legacy_time_block_id = r.target_id
 where r.source_type = 'task' and r.source_id = t.id and r.target_type = 'time_block'
   and r.deleted_at is null and t.home_block_type_id is null;

-- Old rollover: migrate tasks are no longer moved by the database (the ritual does it)
create or replace function public.process_task_rollover(p_user uuid default null)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  total integer := 0;
  c integer;
begin
  update public.tasks t
     set status = 'backlog',
         rolled_over_count = t.rolled_over_count + 1,
         occurrence_id = null,
         event_id = null
    from public.user_settings s
   where s.user_id = t.user_id
     and (p_user is null or t.user_id = p_user)
     and t.deleted_at is null
     and t.status = 'pending'
     and t.rollover_policy = 'backlog'
     and t.scheduled_for < (now() at time zone s.timezone)::date;
  get diagnostics c = row_count; total := total + c;

  update public.tasks t
     set status = 'failed'
    from public.user_settings s
   where s.user_id = t.user_id
     and (p_user is null or t.user_id = p_user)
     and t.deleted_at is null
     and t.status = 'pending'
     and t.rollover_policy = 'graveyard'
     and t.scheduled_for < (now() at time zone s.timezone)::date;
  get diagnostics c = row_count; total := total + c;

  return total;
end $$;

revoke execute on function public.process_task_rollover(uuid) from public, anon, authenticated;
