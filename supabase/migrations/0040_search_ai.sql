-- Personal OS - 0040: AI summary of a search (Nov 2026)
--  · search_passages()  every piece of the found notes where the words appear (for the AI to read)
--  · search_ai_cache    the AI's answer for a search, kept a day (the same search isn't paid twice)
-- Safe to run twice. Nothing is deleted.

create or replace function public.search_passages(p_user uuid, p_query text, p_notes uuid[], p_kinds text[] default null)
returns table (note_id uuid, kind text, label text, anchor text, body text, r real)
language sql stable security invoker set search_path = public, extensions
as $$
  select c.note_id, c.kind, c.label, c.anchor, c.body, ts_rank(c.tsv, to_tsquery('simple'::regconfig, p_query))::real as r
  from search_chunks c
  where c.user_id = p_user
    and c.note_id = any (p_notes)
    and (p_kinds is null or c.kind = any (p_kinds))
    and c.tsv @@ to_tsquery('simple'::regconfig, p_query)
  order by c.note_id, r desc, c.ord;
$$;

create table if not exists public.search_ai_cache (
  user_id    uuid not null default auth.uid() references auth.users(id) on delete cascade,
  key        text not null,
  answer     jsonb not null,
  created_at timestamptz not null default now(),
  primary key (user_id, key)
);
alter table public.search_ai_cache enable row level security;
do $$ begin
  if not exists (select 1 from pg_policies where tablename = 'search_ai_cache' and policyname = 'own rows') then
    create policy "own rows" on public.search_ai_cache for all to authenticated
      using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
  end if;
end $$;
