-- Personal OS - 0054: Template Manager phase 3 — project profiles and automatic filling.
-- A project profile keeps a project's details once (name, sponsor, dates, goal, team, milestones, risks...) in
-- English and/or Spanish; working copies are filled from it. "My details" (is_defaults) holds what repeats in every
-- project (organization, you as project manager...) and starts every new profile.
-- tm_field_maps remembers, per original file, which blank gets which field (found by the scan, confirmed by you).
-- Additive and safe to run twice. Nothing existing changes.

create table if not exists public.tm_projects (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  name text not null,
  code text,
  is_defaults boolean not null default false,
  data jsonb not null default '{}'::jsonb,
  notes text,
  archived boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index if not exists tm_projects_name_idx on public.tm_projects (user_id, lower(name)) where not is_defaults;
create unique index if not exists tm_projects_defaults_idx on public.tm_projects (user_id) where is_defaults;

create table if not exists public.tm_field_maps (
  file_id uuid primary key references public.tm_files(id) on delete cascade,
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  template_id uuid references public.tm_templates(id) on delete cascade,
  items jsonb not null default '[]'::jsonb,
  confirmed boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists tm_field_maps_template_idx on public.tm_field_maps (template_id);

alter table public.tm_copies add column if not exists project_id uuid references public.tm_projects(id) on delete set null;
alter table public.tm_copies add column if not exists source_file_id uuid references public.tm_files(id) on delete set null;
alter table public.tm_copies add column if not exists filled jsonb;
alter table public.tm_copies add column if not exists filled_at timestamptz;
create index if not exists tm_copies_project_idx on public.tm_copies (project_id);

alter table public.tm_projects enable row level security;
drop policy if exists "tm_projects own rows" on public.tm_projects;
create policy "tm_projects own rows" on public.tm_projects for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());

alter table public.tm_field_maps enable row level security;
drop policy if exists "tm_field_maps own rows" on public.tm_field_maps;
create policy "tm_field_maps own rows" on public.tm_field_maps for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());

drop trigger if exists tm_projects_updated_at on public.tm_projects;
create trigger tm_projects_updated_at before update on public.tm_projects
  for each row execute function public.set_updated_at();
drop trigger if exists tm_field_maps_updated_at on public.tm_field_maps;
create trigger tm_field_maps_updated_at before update on public.tm_field_maps
  for each row execute function public.set_updated_at();

comment on table public.tm_projects is 'Template Manager add-on: project profiles (bilingual details used to fill templates); one is_defaults row = "My details".';
comment on table public.tm_field_maps is 'Template Manager add-on: which blank of an original file gets which profile field.';
