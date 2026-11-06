-- Personal OS - 0039: search engine for every word in every note (Nov 2026)
--  · search_chunks   the text of each note in small pieces (title, headings, body, code, tables,
--                    properties, files), with a full-text index (accents ignored) and a trigram index
--  · search_state    which version of each note is in the index (so only changed notes are redone)
--  · search_files    attached files waiting to be read / already read (PDF, Word, Excel, PowerPoint, text)
--  · search_notes()  the search: every word somewhere in the note, ranked, with the best pieces
--  · search_suggest() closest indexed word for a typo
-- Safe to run twice. Nothing of yours is changed: the index is built by the app (cron every 5 min).

create extension if not exists unaccent with schema extensions;
create extension if not exists pg_trgm with schema extensions;

create or replace function public.pos_unaccent(t text) returns text
  language sql immutable parallel safe strict
  set search_path = ''
  as $$ select extensions.unaccent('extensions.unaccent'::regdictionary, t) $$;

create table if not exists public.search_chunks (
  id         bigint generated always as identity primary key,
  user_id    uuid not null default auth.uid() references auth.users(id) on delete cascade,
  note_id    uuid not null references public.notes(id) on delete cascade,
  kind       text not null,             -- title | heading | text | code | table | props | media | file
  label      text,                      -- "python", "budget.pdf · page 3", the heading…
  anchor     text,                      -- the heading / block it belongs to (to jump there)
  file_path  text,                      -- for kind = file: the Storage path
  weight     "char" not null default 'C',
  ord        integer not null default 0,
  body       text not null default '',
  extra      text not null default '',  -- searchable but never shown (split code words, digits-only numbers)
  tsv        tsvector generated always as (
               setweight(to_tsvector('simple'::regconfig, public.pos_unaccent(lower(body || ' ' || extra))), weight)
             ) stored
);
create index if not exists search_chunks_tsv_idx on public.search_chunks using gin (tsv);
create index if not exists search_chunks_note_idx on public.search_chunks (user_id, note_id);
alter table public.search_chunks enable row level security;
drop policy if exists "own rows" on public.search_chunks;
create policy "own rows" on public.search_chunks for all to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));

create table if not exists public.search_state (
  note_id    uuid primary key references public.notes(id) on delete cascade,
  user_id    uuid not null default auth.uid() references auth.users(id) on delete cascade,
  hash       text not null,
  indexed_at timestamptz not null default now()
);
create index if not exists search_state_user_idx on public.search_state (user_id);
alter table public.search_state enable row level security;
drop policy if exists "own rows" on public.search_state;
create policy "own rows" on public.search_state for all to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));

create table if not exists public.search_files (
  note_id    uuid not null references public.notes(id) on delete cascade,
  path       text not null,
  user_id    uuid not null default auth.uid() references auth.users(id) on delete cascade,
  name       text not null default '',
  status     text not null default 'pending',  -- pending | done | no_text | failed | skipped
  detail     text,
  attempts   integer not null default 0,
  chars      integer not null default 0,
  updated_at timestamptz not null default now(),
  primary key (note_id, path)
);
create index if not exists search_files_pending_idx on public.search_files (status, updated_at);
alter table public.search_files enable row level security;
drop policy if exists "own rows" on public.search_files;
create policy "own rows" on public.search_files for all to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));

-- p_terms: one tsquery per word / phrase / OR-group (all must match somewhere in the note).
-- p_not: tsqueries that must NOT match anywhere in the note. p_kinds: only these kinds of pieces (null = all).
create or replace function public.search_notes(
  p_user uuid, p_terms text[], p_not text[] default '{}', p_kinds text[] default null,
  p_trash boolean default false, p_templates boolean default false,
  p_limit integer default 20, p_offset integer default 0
) returns table (note_id uuid, score real, total bigint, hits jsonb)
language sql stable security invoker set search_path = public, extensions
as $$
  with hit as (
    select c.id, c.note_id, c.kind, c.label, c.anchor, c.file_path, c.body, t.i,
           ts_rank(c.tsv, to_tsquery('simple'::regconfig, t.q)) as r
    from search_chunks c
    join notes n on n.id = c.note_id
    cross join lateral unnest(p_terms) with ordinality as t(q, i)
    where c.user_id = p_user and n.user_id = p_user
      and n.merged_into is null
      and (p_trash or n.deleted_at is null)
      and (p_templates or not coalesce(n.is_template, false))
      and (p_kinds is null or c.kind = any (p_kinds))
      and c.tsv @@ to_tsquery('simple'::regconfig, t.q)
  ),
  ok as (
    select h.note_id from hit h group by h.note_id
    having count(distinct h.i) = coalesce(cardinality(p_terms), 0)
  ),
  bad as (
    select distinct c.note_id from search_chunks c
    cross join lateral unnest(coalesce(p_not, '{}')) as x(q)
    where c.user_id = p_user and c.tsv @@ to_tsquery('simple'::regconfig, x.q)
  ),
  piece as (
    select h.note_id, h.id, h.kind, h.label, h.anchor, h.file_path, h.body, sum(h.r) as r
    from hit h join ok using (note_id)
    where h.note_id not in (select note_id from bad)
    group by h.note_id, h.id, h.kind, h.label, h.anchor, h.file_path, h.body
  ),
  scored as (
    select p.note_id, sum(p.r)::real as score, count(*) as pieces from piece p group by p.note_id
  )
  select s.note_id, s.score, count(*) over () as total,
         jsonb_build_object(
           'pieces', s.pieces,
           'top', (select jsonb_agg(jsonb_build_object('kind', x.kind, 'label', x.label, 'anchor', x.anchor, 'file', x.file_path, 'body', left(x.body, 4000)) order by x.r desc)
                   from (select * from piece p2 where p2.note_id = s.note_id order by p2.r desc limit 3) x)
         ) as hits
  from scored s join notes n on n.id = s.note_id
  order by s.score desc, n.updated_at desc
  limit greatest(1, least(p_limit, 100)) offset greatest(0, p_offset);
$$;

-- The indexed word closest to a misspelled one (null when nothing is close enough).
create or replace function public.search_suggest(p_user uuid, p_word text)
returns text language plpgsql stable security invoker set search_path = public, extensions
as $$
declare best text;
begin
  select w.word into best
  from ts_stat(format('select tsv from public.search_chunks where user_id = %L', p_user)) w
  where length(w.word) > 2 and similarity(w.word, p_word) > 0.3
  order by similarity(w.word, p_word) desc, w.nentry desc
  limit 1;
  return best;
end $$;

select 'search_chunks' as what, count(*)::text as value from public.search_chunks
union all select 'search_files', count(*)::text from public.search_files;
