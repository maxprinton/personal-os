-- Personal OS - 0051: YouTube topics
--  Topic + Format = Idea (unique per topic and format) · Idea + Angle = Killer idea.
--  · yt_topics       one row per topic, so the app can tell a new topic from one already tried
--  · yt_videos       gets topic_id, format (one main format) and angle (one main angle)
--  · formats[] / angles[] stay as mirrors (the rest of the add-on still reads them)
-- Needs 0031 to 0036. Safe to run twice.

create table if not exists public.yt_topics (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null default auth.uid() references auth.users(id) on delete cascade,
  name        text not null check (char_length(name) between 1 and 200),
  name_key    text not null,
  notes       text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create unique index if not exists yt_topics_key_uq on public.yt_topics (user_id, name_key);
drop trigger if exists yt_topics_touch on public.yt_topics;
create trigger yt_topics_touch before update on public.yt_topics for each row execute function public.yt_touch();
alter table public.yt_topics enable row level security;
drop policy if exists "own rows" on public.yt_topics;
create policy "own rows" on public.yt_topics for all to authenticated using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));

alter table public.yt_videos add column if not exists topic_id uuid references public.yt_topics(id) on delete set null;
alter table public.yt_videos add column if not exists format   text;
alter table public.yt_videos add column if not exists angle    text;
create index if not exists yt_videos_topic_idx on public.yt_videos (user_id, topic_id);

-- Backfill 1: one topic per distinct existing topic text (same key rule as the app: lower case, no accents, single spaces)
insert into public.yt_topics (user_id, name, name_key)
select distinct on (user_id, k) user_id, n, k
from (
  select user_id,
         left(regexp_replace(trim(coalesce(nullif(trim(topic), ''), idea_name)), '\s+', ' ', 'g'), 120) as n,
         translate(lower(left(regexp_replace(trim(coalesce(nullif(trim(topic), ''), idea_name)), '\s+', ' ', 'g'), 120)), 'áéíóúüñàèìòù', 'aeiouunaeiou') as k,
         created_at
  from public.yt_videos
) s
order by user_id, k, created_at
on conflict (user_id, name_key) do nothing;

-- Backfill 2: attach each idea to its topic; copy the first format/angle
update public.yt_videos v
set topic_id = t.id
from public.yt_topics t
where v.topic_id is null
  and t.user_id = v.user_id
  and t.name_key = translate(lower(left(regexp_replace(trim(coalesce(nullif(trim(v.topic), ''), v.idea_name)), '\s+', ' ', 'g'), 120)), 'áéíóúüñàèìòù', 'aeiouunaeiou');

update public.yt_videos set format = formats[1] where format is null and coalesce(array_length(formats, 1), 0) > 0;
update public.yt_videos set angle  = angles[1]  where angle  is null and coalesce(array_length(angles, 1), 0) > 0;

-- Duplicates that already exist: the oldest keeps its format, the newer ones go back to "format not chosen" (nothing is deleted)
with d as (
  select id, row_number() over (partition by user_id, topic_id, format order by created_at, id) as rn
  from public.yt_videos
  where kind = 'long' and topic_id is not null and format is not null and stage <> 'archived'
)
update public.yt_videos v set format = null from d where v.id = d.id and d.rn > 1;

-- The rule: a topic + format pair is used once among long videos (parked ideas free the pair)
create unique index if not exists yt_videos_topic_format_uq on public.yt_videos (user_id, topic_id, format)
  where kind = 'long' and topic_id is not null and format is not null and stage <> 'archived';

select 'yt_topics' as what, count(*)::text as n from public.yt_topics
union all select 'ideas with topic', count(*)::text from public.yt_videos where topic_id is not null
union all select 'unique index', case when exists (select 1 from pg_indexes where indexname = 'yt_videos_topic_format_uq') then 'ok' else 'MISSING' end;
