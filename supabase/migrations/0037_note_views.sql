-- Personal OS - 0037: saved views of the notes database (Nov 2026)
--  · note_views   each tab of the notes database: its name, order, layout, filters, sorts and columns
-- Safe to run twice. Nothing is deleted.

create table if not exists public.note_views (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null default auth.uid() references auth.users(id) on delete cascade,
  name        text not null default 'View',
  position    integer not null default 0,
  state       jsonb not null default '{}'::jsonb,
  extras      jsonb not null default '{}'::jsonb,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index if not exists note_views_user_idx on public.note_views (user_id, position);
alter table public.note_views enable row level security;
drop policy if exists "own rows" on public.note_views;
create policy "own rows" on public.note_views for all to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
drop trigger if exists note_views_updated_at on public.note_views;
create trigger note_views_updated_at before update on public.note_views
  for each row execute function public.set_updated_at();

select 'note_views' as checked, count(*)::text as found from public.note_views;
