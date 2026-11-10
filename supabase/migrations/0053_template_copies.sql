-- Personal OS - 0053: Template Manager phase 2 — working copies with version history.
-- A working copy is "this template, for this project": a copy of one original file that you download, edit in
-- Word / Excel / PowerPoint (or in the app for CSV, text and Mermaid) and upload back as a new version.
-- The original template file is never changed. Versions are rows of tm_files with role 'working_copy'.
-- Additive and safe to run twice. Nothing existing changes.

create table if not exists public.tm_copies (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  template_id uuid not null references public.tm_templates(id) on delete cascade,
  title text not null,
  project text,
  lang text check (lang in ('en', 'es')),
  status text not null default 'active' check (status in ('active', 'done', 'archived')),
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists tm_copies_user_idx on public.tm_copies (user_id, status);
create index if not exists tm_copies_template_idx on public.tm_copies (template_id);

alter table public.tm_files add column if not exists copy_id uuid references public.tm_copies(id) on delete cascade;
alter table public.tm_files add column if not exists version integer not null default 1;
alter table public.tm_files add column if not exists note text;
create index if not exists tm_files_copy_idx on public.tm_files (copy_id, version);

alter table public.tm_copies enable row level security;
drop policy if exists "tm_copies own rows" on public.tm_copies;
create policy "tm_copies own rows" on public.tm_copies for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());

drop trigger if exists tm_copies_updated_at on public.tm_copies;
create trigger tm_copies_updated_at before update on public.tm_copies
  for each row execute function public.set_updated_at();

comment on table public.tm_copies is 'Template Manager add-on: working copies of a template for a project; versions live in tm_files (role working_copy).';
