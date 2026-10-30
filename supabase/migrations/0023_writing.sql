-- Personal OS - 0023: the writing checker's glossary
--  · writing_glossary  words the spelling check never marks ("Add to dictionary"), the same on every device.
-- Safe to run twice.

create table if not exists public.writing_glossary (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null default auth.uid() references auth.users(id) on delete cascade,
  word        text not null check (length(trim(word)) > 0 and length(word) <= 100),
  created_at  timestamptz not null default now()
);
create unique index if not exists writing_glossary_word_uq on public.writing_glossary (user_id, lower(word));
alter table public.writing_glossary enable row level security;
drop policy if exists "own rows" on public.writing_glossary;
create policy "own rows" on public.writing_glossary for all to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
