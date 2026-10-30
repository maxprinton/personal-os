-- Personal OS - 0024: the writing assistant, part 2
--  · user_settings.writing   on/off per language and area, the AI's daily count, your voice profile
--  · writing_ngrams          which words you write after which (next-word prediction), learned from your text
--  · writing_unknown         unknown words and on how many days you wrote them (asks to add after 3 days)
--  · writing_mistakes        corrections you accepted, per week (your most repeated mistakes in Insights)
-- Functions run as you (security invoker), so row level security still applies. Safe to run twice.

alter table public.user_settings add column if not exists writing jsonb not null default '{}'::jsonb;

create table if not exists public.writing_ngrams (
  user_id     uuid not null default auth.uid() references auth.users(id) on delete cascade,
  ctx         text not null,            -- '' (any), 'word' or 'word word': what came before
  next        text not null,            -- the word that came after
  n           integer not null default 1,
  updated_at  timestamptz not null default now(),
  primary key (user_id, ctx, next)
);
create index if not exists writing_ngrams_rank_idx on public.writing_ngrams (user_id, n desc);

create table if not exists public.writing_unknown (
  user_id   uuid not null default auth.uid() references auth.users(id) on delete cascade,
  word      text not null,              -- lower case
  days      integer not null default 1,
  last_day  date not null,
  primary key (user_id, word)
);

create table if not exists public.writing_mistakes (
  user_id  uuid not null default auth.uid() references auth.users(id) on delete cascade,
  week     date not null,               -- the Monday of that week
  wrong    text not null,               -- lower case
  fixed    text not null,               -- lower case
  n        integer not null default 1,
  primary key (user_id, week, wrong, fixed)
);

do $$
declare t text;
begin
  foreach t in array array['writing_ngrams', 'writing_unknown', 'writing_mistakes'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists "own rows" on public.%I', t);
    execute format('create policy "own rows" on public.%I for all to authenticated using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()))', t);
  end loop;
end $$;

-- Adds counts: p_rows = [{"c": "voy al", "w": "gimnasio", "n": 1}, …]
create or replace function public.writing_learn(p_rows jsonb)
returns void language sql security invoker set search_path = public as $$
  insert into public.writing_ngrams (user_id, ctx, next, n)
  select auth.uid(), left(r->>'c', 80), left(r->>'w', 40), greatest(1, least(1000, coalesce((r->>'n')::int, 1)))
    from jsonb_array_elements(p_rows) r
   where coalesce(r->>'w', '') <> ''
  on conflict (user_id, ctx, next) do update
    set n = public.writing_ngrams.n + excluded.n, updated_at = now();
$$;

-- The most used rows, in one answer (no 1000-row page limit)
create or replace function public.writing_model(p_max integer default 40000)
returns jsonb language sql stable security invoker set search_path = public as $$
  select coalesce(jsonb_agg(jsonb_build_array(ctx, next, n)), '[]'::jsonb)
    from (select ctx, next, n from public.writing_ngrams
           where user_id = auth.uid() order by n desc limit greatest(1, least(p_max, 60000))) t;
$$;

-- Unknown words seen today (each word counts once per day)
create or replace function public.writing_seen(p_words text[], p_day date)
returns void language sql security invoker set search_path = public as $$
  insert into public.writing_unknown (user_id, word, days, last_day)
  select auth.uid(), lower(left(w, 100)), 1, p_day from unnest(p_words) as u(w) where coalesce(w, '') <> ''
  on conflict (user_id, word) do update
    set days = public.writing_unknown.days + case when public.writing_unknown.last_day < excluded.last_day then 1 else 0 end,
        last_day = greatest(public.writing_unknown.last_day, excluded.last_day);
$$;

-- A correction you accepted
create or replace function public.writing_mistake(p_wrong text, p_fixed text, p_week date)
returns void language sql security invoker set search_path = public as $$
  insert into public.writing_mistakes (user_id, week, wrong, fixed, n)
  values (auth.uid(), p_week, lower(left(p_wrong, 100)), lower(left(p_fixed, 100)), 1)
  on conflict (user_id, week, wrong, fixed) do update set n = public.writing_mistakes.n + 1;
$$;
