-- Personal OS - 0052: Template Manager add-on (phases 0 and 1)
-- A library of project-management template FILES (Word, Excel, PowerPoint, PDF, Mermaid notes...).
-- Not the same thing as note templates (notes.is_template): these are files you download, fill and reuse.
-- Files live in the existing private "note-files" bucket under <your user id>/templates/<template id>/...,
-- so the existing /api/files link (signed, only for you) works for them too. No new bucket is needed.
-- Additive and safe to run twice. Nothing existing changes.

create table if not exists public.tm_templates (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  code text,                                   -- e.g. INI-04 (library templates); null for your own uploads
  name text not null,
  name_es text,
  phase text check (phase in ('INI', 'PLN', 'EXE', 'MON', 'CLO')),
  grp text not null default 'other',           -- base, scrum, kanban, lean, dmaic, dmadv, p2, wf, hyb, other
  format text not null default 'other',        -- docx, xlsx, pptx, pdf, csv, md, mermaid, note, image, link, other
  approaches text[] not null default '{}',
  doc_type text,
  tags text[] not null default '{}',
  status text not null default 'inbox' check (status in ('inbox', 'reviewed', 'ready')),
  favorite boolean not null default false,
  rating smallint check (rating between 1 and 5),
  source text,
  source_url text,
  about jsonb not null default '{}'::jsonb,    -- {"en": {"best","use","skip","value","vars"}, "es": {...}}
  notes text,
  times_used integer not null default 0,
  last_used_at timestamptz,
  deleted_at timestamptz,                      -- in the trash since; deleted for good after 30 days
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint tm_templates_user_code unique (user_id, code)
);
create index if not exists tm_templates_user_idx on public.tm_templates (user_id, deleted_at);

create table if not exists public.tm_files (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  template_id uuid not null references public.tm_templates(id) on delete cascade,
  lang text check (lang in ('en', 'es')),
  role text not null default 'original' check (role in ('original', 'working_copy', 'preview')),
  storage_path text not null,
  file_name text not null,
  mime text,
  size bigint not null default 0,
  sha256 text,
  created_at timestamptz not null default now(),
  constraint tm_files_path unique (user_id, storage_path)
);
create index if not exists tm_files_template_idx on public.tm_files (template_id);
create index if not exists tm_files_hash_idx on public.tm_files (user_id, sha256);

alter table public.tm_templates enable row level security;
alter table public.tm_files enable row level security;

drop policy if exists "tm_templates own rows" on public.tm_templates;
create policy "tm_templates own rows" on public.tm_templates for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());
drop policy if exists "tm_files own rows" on public.tm_files;
create policy "tm_files own rows" on public.tm_files for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());

drop trigger if exists tm_templates_updated_at on public.tm_templates;
create trigger tm_templates_updated_at before update on public.tm_templates
  for each row execute function public.set_updated_at();

comment on table public.tm_templates is 'Template Manager add-on: project-management template files (library). Not note templates.';
comment on table public.tm_files is 'Template Manager add-on: the files of each template (EN / ES originals, later working copies).';
