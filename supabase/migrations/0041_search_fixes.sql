-- Personal OS - 0041: search fixes (Nov 2026)
--  · search_notes()   fairer ranking: a note scores by the best piece for EACH word (plus a small bonus
--                     for more matching pieces), so long notes no longer win just by being long
--  · search_words     every indexed word once per user, with a trigram index (fast typo suggestions;
--                     0039 said it had a trigram index but never created one)
--  · refresh_search_words(user)  rebuilds that list (the app calls it after indexing)
--  · search_suggest() uses the list (falls back to the old way while the list is empty)
-- Safe to run twice. Nothing of yours is changed.

create extension if not exists pg_trgm with schema extensions;

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
  good as (
    select h.* from hit h join ok using (note_id)
    where h.note_id not in (select note_id from bad)
  ),
  piece as (
    select g.note_id, g.id, g.kind, g.label, g.anchor, g.file_path, g.body, sum(g.r) as r
    from good g
    group by g.note_id, g.id, g.kind, g.label, g.anchor, g.file_path, g.body
  ),
  best as (  -- the best piece for each word / phrase
    select x.note_id, sum(x.r) as r from (
      select g.note_id, g.i, max(g.r) as r from good g group by g.note_id, g.i
    ) x group by x.note_id
  ),
  scored as (
    select b.note_id, (b.r + 0.05 * ln(1 + count(p.id)))::real as score, count(p.id) as pieces
    from best b join piece p using (note_id)
    group by b.note_id, b.r
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

create table if not exists public.search_words (
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  word    text not null,
  n       integer not null default 0,
  primary key (user_id, word)
);
create index if not exists search_words_trgm_idx on public.search_words using gin (word extensions.gin_trgm_ops);
alter table public.search_words enable row level security;
drop policy if exists "own rows" on public.search_words;
create policy "own rows" on public.search_words for all to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));

-- Rebuilds one user's word list from the index. Returns how many words it has.
create or replace function public.refresh_search_words(p_user uuid)
returns integer language plpgsql volatile security invoker set search_path = public, extensions
as $$
declare k integer;
begin
  delete from public.search_words where user_id = p_user;
  insert into public.search_words (user_id, word, n)
  select p_user, w.word, w.nentry
  from ts_stat(format('select tsv from public.search_chunks where user_id = %L', p_user)) w
  where length(w.word) between 3 and 40;
  get diagnostics k = row_count;
  return k;
end $$;

-- The indexed word closest to a misspelled one (null when nothing is close enough).
create or replace function public.search_suggest(p_user uuid, p_word text)
returns text language plpgsql stable security invoker set search_path = public, extensions
as $$
declare best text;
begin
  if exists (select 1 from public.search_words where user_id = p_user) then
    select w.word into best
    from public.search_words w
    where w.user_id = p_user and w.word % p_word and similarity(w.word, p_word) > 0.3
    order by similarity(w.word, p_word) desc, w.n desc
    limit 1;
    return best;
  end if;
  select w.word into best
  from ts_stat(format('select tsv from public.search_chunks where user_id = %L', p_user)) w
  where length(w.word) > 2 and similarity(w.word, p_word) > 0.3
  order by similarity(w.word, p_word) desc, w.nentry desc
  limit 1;
  return best;
end $$;

-- Fill the list now for everyone who has an index
select public.refresh_search_words(u.user_id) as words
from (select distinct user_id from public.search_chunks) u;
