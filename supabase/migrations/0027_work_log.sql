-- Personal OS - 0027: work log (substitute ESL classes)
--  · work_classes   one row per class you taught: group, date, start/end, hours, rate, pay, the company Sheet's
--                   "Tipo de clase" and "Solicitud", and whether the class video is posted (+ its Drive link).
--  · work_settings  your name for the Sheet ("Docente"), pay per hour as substitute / head teacher, and the
--                   Drive folder where the videos go.
-- Safe to run twice.

create table if not exists public.work_classes (
  id              uuid primary key default gen_random_uuid(),
  user_id         uuid not null default auth.uid() references auth.users(id) on delete cascade,
  class_date      date not null,
  start_time      time not null,
  end_time        time not null,
  group_name      text not null,
  role            text not null default 'substitute' check (role in ('substitute', 'head')),
  sheet_type      text check (sheet_type in ('recovery', 'extra', 'collaboration')),
  requested_by    text,
  hours           numeric(6,2) not null check (hours > 0),
  rate            numeric(8,2) not null check (rate >= 0),
  amount          numeric(10,2) generated always as (round(hours * rate, 2)) stored,
  video_posted    boolean not null default false,
  video_url       text,
  video_posted_at timestamptz,
  notes           text,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);
create index if not exists work_classes_user_date_idx on public.work_classes (user_id, class_date desc, start_time);
create index if not exists work_classes_pending_video_idx on public.work_classes (user_id, class_date) where video_posted = false;
alter table public.work_classes enable row level security;
drop policy if exists "own rows" on public.work_classes;
create policy "own rows" on public.work_classes for all to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));

create table if not exists public.work_settings (
  user_id          uuid primary key default auth.uid() references auth.users(id) on delete cascade,
  teacher_name     text,
  substitute_rate  numeric(8,2) not null default 6 check (substitute_rate >= 0),
  head_rate        numeric(8,2) not null default 4 check (head_rate >= 0),
  video_folder_url text,
  updated_at       timestamptz not null default now()
);
alter table public.work_settings enable row level security;
drop policy if exists "own rows" on public.work_settings;
create policy "own rows" on public.work_settings for all to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
