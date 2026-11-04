-- Personal OS - 0032: YouTube Pipeline add-on (2 of 6) — ideation, package, research lab
--  · yt_references  outlier videos saved for an idea (Topic step, watchlist) — also shown in the "References" bucket
--  · yt_variants    package candidates: titles and thumbnail concepts (up to 3 each in the UI)
--  · yt_pairs       title + thumbnail combinations A / B / C (the A/B variants)
--  · yt_buckets     research buckets of a video; video_id NULL = topic shelf (permanent, shared by every video)
--  · yt_cards       what goes in a bucket: note | fragment | quick | link | reference
-- Needs 0031. Safe to run twice.

create table if not exists public.yt_references (
  id             uuid primary key default gen_random_uuid(),
  user_id        uuid not null default auth.uid() references auth.users(id) on delete cascade,
  video_id       uuid references public.yt_videos(id) on delete cascade,
  yt_id          text,
  url            text not null,
  title          text not null default '',
  channel_id     text,
  channel_title  text,
  channel_subs   bigint,
  views          bigint,
  channel_median bigint,
  outlier_score  numeric,
  published_at   timestamptz,
  thumbnail_url  text,
  duration_s     integer,
  is_short       boolean not null default false,
  source         text not null default 'finder' check (source in ('finder','manual','watchlist')),
  note           text,
  position       integer not null default 0,
  created_at     timestamptz not null default now()
);
create index if not exists yt_references_video_idx on public.yt_references (video_id, position);
create unique index if not exists yt_references_uq on public.yt_references (video_id, yt_id) where yt_id is not null and video_id is not null;

create table if not exists public.yt_variants (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null default auth.uid() references auth.users(id) on delete cascade,
  video_id     uuid not null references public.yt_videos(id) on delete cascade,
  kind         text not null check (kind in ('title','thumbnail')),
  label        text,
  position     integer not null default 0,
  value        text not null default '',
  gap_type     text check (gap_type in ('moment','story','result','transformation','novelty')),
  focal        text,
  supporting   text,
  composition  text,
  contrast     text[] not null default '{}',
  stoppers     text[] not null default '{}',
  thumb_text   text,
  image_url    text,
  tests        jsonb not null default '{}'::jsonb,
  attrs        jsonb not null default '{}'::jsonb,
  archived     boolean not null default false,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);
create index if not exists yt_variants_video_idx on public.yt_variants (video_id, kind, position);
drop trigger if exists yt_variants_touch on public.yt_variants;
create trigger yt_variants_touch before update on public.yt_variants for each row execute function public.yt_touch();

create table if not exists public.yt_pairs (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null default auth.uid() references auth.users(id) on delete cascade,
  video_id      uuid not null references public.yt_videos(id) on delete cascade,
  label         text not null default 'A',
  title_id      uuid references public.yt_variants(id) on delete set null,
  thumbnail_id  uuid references public.yt_variants(id) on delete set null,
  position      integer not null default 0,
  is_primary    boolean not null default false,
  active_from   timestamptz,
  active_to     timestamptz,
  result        text,
  notes         text,
  created_at    timestamptz not null default now()
);
create index if not exists yt_pairs_video_idx on public.yt_pairs (video_id, position);
create unique index if not exists yt_pairs_primary_uq on public.yt_pairs (video_id) where is_primary;

create table if not exists public.yt_buckets (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null default auth.uid() references auth.users(id) on delete cascade,
  video_id    uuid references public.yt_videos(id) on delete cascade,
  is_shelf    boolean generated always as (video_id is null) stored,
  name        text not null,
  description text,
  color       text,
  position    integer not null default 0,
  created_at  timestamptz not null default now()
);
create index if not exists yt_buckets_video_idx on public.yt_buckets (user_id, video_id, position);

create table if not exists public.yt_cards (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null default auth.uid() references auth.users(id) on delete cascade,
  bucket_id     uuid not null references public.yt_buckets(id) on delete cascade,
  video_id      uuid references public.yt_videos(id) on delete cascade,
  kind          text not null check (kind in ('note','fragment','quick','link','reference')),
  note_id       uuid references public.notes(id) on delete set null,
  block_id      text,
  quote_text    text,
  url           text,
  preview       jsonb,
  text          text,
  annotation    text,
  reference_id  uuid references public.yt_references(id) on delete cascade,
  position      integer not null default 0,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create index if not exists yt_cards_bucket_idx on public.yt_cards (bucket_id, position);
create index if not exists yt_cards_video_idx on public.yt_cards (video_id) where video_id is not null;
create index if not exists yt_cards_note_idx on public.yt_cards (note_id) where note_id is not null;
drop trigger if exists yt_cards_touch on public.yt_cards;
create trigger yt_cards_touch before update on public.yt_cards for each row execute function public.yt_touch();

do $$
declare t text;
begin
  foreach t in array array['yt_references','yt_variants','yt_pairs','yt_buckets','yt_cards'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists "own rows" on public.%I', t);
    execute format('create policy "own rows" on public.%I for all to authenticated using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()))', t);
  end loop;
end $$;
