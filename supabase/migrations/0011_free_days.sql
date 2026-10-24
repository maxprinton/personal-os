-- Personal OS - Calendar v2, phase 6: free days (trips, holidays, sick days).
-- A free-day range pauses every block in it: blocks show dimmed as "free day", habits are not
-- marked missed (streaks pause), nothing nags. Events (flights, hotel) stay visible.
-- task_policy = what happens to the tasks of those dates when the range is created:
--   move_next   -> to the day after the range
--   unassigned  -> to the day after the range, left unassigned (not auto-placed)
--   home_block  -> to the next date after the range where their home block exists
-- Requires 0007 and 0010. Safe to run twice.

do $$ begin
  create type free_day_task_policy as enum ('move_next', 'unassigned', 'home_block');
exception when duplicate_object then null; end $$;

create table if not exists public.free_days (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null default auth.uid() references auth.users(id) on delete cascade,
  from_date    date not null,
  to_date      date not null,
  task_policy  free_day_task_policy not null default 'move_next',
  note         text,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  deleted_at   timestamptz,
  check (to_date >= from_date)
);
create index if not exists free_days_user_range_idx on public.free_days (user_id, from_date, to_date) where deleted_at is null;

drop trigger if exists free_days_updated_at on public.free_days;
create trigger free_days_updated_at before update on public.free_days
  for each row execute function public.set_updated_at();
alter table public.free_days enable row level security;
drop policy if exists "own rows" on public.free_days;
create policy "own rows" on public.free_days for all to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));

-- Tasks sent to "unassigned" by a free day are not auto-placed in their home block
alter table public.tasks add column if not exists hold_placement boolean not null default false;
