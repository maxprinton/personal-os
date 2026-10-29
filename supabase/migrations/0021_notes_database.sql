-- Personal OS - 0021: notes as a Notion database + templates (29 Oct 2026)
--  · note_properties        the columns of the notes database (built-in ones + the ones you create)
--  · notes.props            each note's values, by property id
--  · notes.seq              NOTE-12: a number per note (per user), given automatically
--  · notes.is_template      a template (edited like a page; not shown with the notes)
--  · notes.template         a template's settings: default, for which Type, schedule
--  · notes.template_id      the template a note was made from (its "series": ← previous · next →)
--  · notes.series_key       which date of the schedule it belongs to (never two for the same date)
-- Safe to run twice. Nothing is deleted.

create table if not exists public.note_properties (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null default auth.uid() references auth.users(id) on delete cascade,
  key         text not null,
  name        text not null,
  type        text not null,
  config      jsonb not null default '{}'::jsonb,
  position    integer not null default 0,
  hidden      boolean not null default false,
  builtin     boolean not null default false,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  deleted_at  timestamptz
);
create unique index if not exists note_properties_key_uq on public.note_properties (user_id, key) where deleted_at is null;
alter table public.note_properties enable row level security;
drop policy if exists "own rows" on public.note_properties;
create policy "own rows" on public.note_properties for all to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
drop trigger if exists note_properties_updated_at on public.note_properties;
create trigger note_properties_updated_at before update on public.note_properties
  for each row execute function public.set_updated_at();

alter table public.notes add column if not exists props jsonb not null default '{}'::jsonb;
alter table public.notes add column if not exists seq integer;
alter table public.notes add column if not exists is_template boolean not null default false;
alter table public.notes add column if not exists template jsonb not null default '{}'::jsonb;
alter table public.notes add column if not exists template_id uuid references public.notes(id) on delete set null;
alter table public.notes add column if not exists series_key text;

create index if not exists notes_template_idx on public.notes (user_id, is_template) where deleted_at is null;
create unique index if not exists notes_series_uq on public.notes (template_id, series_key)
  where deleted_at is null and series_key is not null;

-- NOTE-12: numbers for the notes that already exist (oldest first), then one for every new note
with numbered as (
  select id, row_number() over (partition by user_id order by created_at, id) as n
  from public.notes where seq is null
)
update public.notes t set seq = coalesce((select max(seq) from public.notes m where m.user_id = t.user_id), 0) + numbered.n
from numbered where t.id = numbered.id;

create or replace function public.notes_set_seq() returns trigger language plpgsql as $$
begin
  if new.seq is null then
    perform pg_advisory_xact_lock(hashtext('notes_seq_' || new.user_id::text));
    select coalesce(max(seq), 0) + 1 into new.seq from public.notes where user_id = new.user_id;
  end if;
  return new;
end $$;
drop trigger if exists notes_seq on public.notes;
create trigger notes_seq before insert on public.notes for each row execute function public.notes_set_seq();
create unique index if not exists notes_seq_uq on public.notes (user_id, seq) where seq is not null;

-- Check: should list the new pieces
select 'note_properties' as what, count(*)::text as value from public.note_properties
union all
select 'notes with NOTE-number', count(*)::text from public.notes where seq is not null
union all
select 'notes.template column', count(*)::text from information_schema.columns
  where table_schema = 'public' and table_name = 'notes' and column_name = 'template';
