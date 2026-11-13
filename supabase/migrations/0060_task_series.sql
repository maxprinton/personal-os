-- Personal OS - 0060: recurring tasks that repeat AFTER being done.
-- A "series" is the template (title, home block, policy, "every N days/weeks/months/years after done").
-- It always has at most ONE open task (current_task_id). Marking that task done creates the next one, due
-- (day it was finished + interval), exactly on that day: in its home block if the block exists that day,
-- otherwise unassigned. Finished tasks stay as history (tasks.series_id).
-- Additive and safe to run twice.

create table if not exists public.task_series (
  id                  uuid primary key default gen_random_uuid(),
  user_id             uuid not null default auth.uid() references auth.users(id) on delete cascade,
  title               text not null check (length(trim(title)) > 0),
  home_block_type_id  uuid references public.block_types(id) on delete set null,
  rollover_policy     public.rollover_policy not null default 'migrate'
                        check (rollover_policy::text in ('migrate', 'backlog')),
  repeat_unit         text not null check (repeat_unit in ('days', 'weeks', 'months', 'years')),
  repeat_every        integer not null default 1 check (repeat_every between 1 and 366),
  mode                text not null default 'after_done' check (mode in ('after_done', 'fixed')),
  active              boolean not null default true,
  current_task_id     uuid references public.tasks(id) on delete set null,
  last_done_task_id   uuid references public.tasks(id) on delete set null,
  last_done_on        date,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  deleted_at          timestamptz
);
create index if not exists task_series_user_idx on public.task_series (user_id) where deleted_at is null;

alter table public.tasks
  add column if not exists series_id uuid references public.task_series(id) on delete set null;
create index if not exists tasks_series_idx on public.tasks (series_id) where deleted_at is null;

drop trigger if exists task_series_updated_at on public.task_series;
create trigger task_series_updated_at before update on public.task_series
  for each row execute function public.set_updated_at();

alter table public.task_series enable row level security;
drop policy if exists "own rows" on public.task_series;
create policy "own rows" on public.task_series for all to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
