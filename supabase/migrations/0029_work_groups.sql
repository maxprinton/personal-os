-- Personal OS - 0029: which teacher each class code belongs to
--  · work_groups   one row per class code (B2-5, KIDS-7…) with the teacher it belongs to RIGHT NOW.
--                  Codes get reused by other teachers, so this is the "current" owner; past classes keep the teacher they were saved with.
-- Optional: without it the app still remembers the teacher from your latest class with that code. Safe to run twice.

create table if not exists public.work_groups (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null default auth.uid() references auth.users(id) on delete cascade,
  code       text not null,
  code_key   text not null,
  teacher    text not null,
  effective_from date not null default current_date,  -- a class dated AFTER this day with another teacher wins over this row
  updated_at timestamptz not null default now(),
  unique (user_id, code_key)
);
alter table public.work_groups enable row level security;
drop policy if exists "own rows" on public.work_groups;
create policy "own rows" on public.work_groups for all to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
