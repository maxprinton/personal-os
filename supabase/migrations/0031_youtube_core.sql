-- Personal OS - 0031: YouTube Pipeline add-on (1 of 6) — core
--  · yt_settings     one row per user: channel link, view goal, words per minute, work-in-progress limit,
--                    outlier finder filters, sonic identity (Music Lab), score weights, weekly review, last V-number
--  · yt_videos       THE entity: one row per video idea, from the idea bank to published (long or short).
--                    code "V012" is given automatically (per user, never reused) when the idea leaves the bank
--                    (stage beyond "idea") or when approved_at is set.
--  · yt_video_links  video ↔ video: series, follow_up, watch_next
-- Safe to run twice.

-- updated_at helper shared by every yt_ table
create or replace function public.yt_touch() returns trigger language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end $$;

create table if not exists public.yt_settings (
  user_id         uuid primary key default auth.uid() references auth.users(id) on delete cascade,
  channel_url     text,
  channel_id      text,
  channel_title   text,
  channel_handle  text,
  view_goal       integer check (view_goal is null or view_goal >= 0),
  words_per_min   integer not null default 150 check (words_per_min between 60 and 400),
  wip_limit       integer not null default 3 check (wip_limit between 1 and 50),
  finder_filters  jsonb not null default '{"min_views":100000,"max_subs":500000,"min_outlier":3,"min_age_days":14,"max_results":25}'::jsonb,
  score_weights   jsonb not null default '{}'::jsonb,
  sonic_identity  jsonb not null default '{}'::jsonb,
  weekly_review   jsonb not null default '{"day":0,"time":"18:00","telegram":true,"note":true}'::jsonb,
  publish_defaults jsonb not null default '{}'::jsonb,
  footage_root    text,
  last_code       integer not null default 0,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);
drop trigger if exists yt_settings_touch on public.yt_settings;
create trigger yt_settings_touch before update on public.yt_settings for each row execute function public.yt_touch();

create table if not exists public.yt_videos (
  id               uuid primary key default gen_random_uuid(),
  user_id          uuid not null default auth.uid() references auth.users(id) on delete cascade,
  seq              integer,
  code             text generated always as (case when seq is null then null else 'V' || lpad(seq::text, 3, '0') end) stored,
  kind             text not null default 'long' check (kind in ('long', 'short')),
  parent_id        uuid references public.yt_videos(id) on delete set null,
  short_role       text check (short_role in ('teaser', 'standalone', 'test')),
  source_start_s   integer check (source_start_s is null or source_start_s >= 0),
  source_end_s     integer check (source_end_s is null or source_end_s >= 0),
  idea_name        text not null,
  topic            text,
  base_idea        text,
  formats          text[] not null default '{}',
  angles           text[] not null default '{}',
  angle_notes      text,
  stage            text not null default 'bank' check (stage in ('bank','idea','package','research','outline','script','shots','filming','edit','publish','published','archived')),
  step             text not null default 'topic' check (step in ('topic','format','angle','criteria')),
  gates            jsonb not null default '{}'::jsonb,
  ratings          jsonb not null default '{}'::jsonb,
  view_potential   numeric,
  data_score       numeric,
  priority         integer not null default 0,
  predicted_views  integer,
  source           text not null default 'web' check (source in ('web','telegram','note','comment','follow_up','short_test','watchlist')),
  source_quote     text,
  note_id          uuid references public.notes(id) on delete set null,
  origin_video_id  uuid references public.yt_videos(id) on delete set null,
  gap_known        text,
  gap_want         text,
  package_ready    boolean not null default false,
  outline_template text,
  outline_locked_at timestamptz,
  footage_folder   text,
  quick_notes      text,
  tags             text[] not null default '{}',
  position         double precision not null default 0,
  approved_at      timestamptz,
  stage_changed_at timestamptz not null default now(),
  scheduled_at     timestamptz,
  youtube_video_id text,
  published_at     timestamptz,
  archived_reason  text,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);
create index if not exists yt_videos_user_stage_idx on public.yt_videos (user_id, stage, position);
create index if not exists yt_videos_user_score_idx on public.yt_videos (user_id, data_score desc nulls last) where stage in ('bank','idea');
create index if not exists yt_videos_parent_idx on public.yt_videos (parent_id) where parent_id is not null;
create index if not exists yt_videos_note_idx on public.yt_videos (note_id) where note_id is not null;
create unique index if not exists yt_videos_seq_uq on public.yt_videos (user_id, seq) where seq is not null;
create unique index if not exists yt_videos_ytid_uq on public.yt_videos (user_id, youtube_video_id) where youtube_video_id is not null;

-- V-number: given once, when the idea is approved (leaves bank/idea) — from a per-user counter, so never reused
create or replace function public.yt_videos_set_seq() returns trigger language plpgsql as $$
declare n integer;
begin
  if new.stage is distinct from coalesce(old.stage, '') then
    new.stage_changed_at := now();
  end if;
  if new.seq is null and (new.approved_at is not null or new.stage not in ('bank','idea','archived')) then
    insert into public.yt_settings (user_id) values (new.user_id) on conflict (user_id) do nothing;
    update public.yt_settings s
       set last_code = greatest(s.last_code, coalesce((select max(v.seq) from public.yt_videos v where v.user_id = new.user_id), 0)) + 1
     where s.user_id = new.user_id
     returning s.last_code into n;
    new.seq := n;
    if new.approved_at is null then new.approved_at := now(); end if;
  end if;
  return new;
end $$;
drop trigger if exists yt_videos_seq on public.yt_videos;
create trigger yt_videos_seq before insert or update on public.yt_videos for each row execute function public.yt_videos_set_seq();
drop trigger if exists yt_videos_touch on public.yt_videos;
create trigger yt_videos_touch before update on public.yt_videos for each row execute function public.yt_touch();

create table if not exists public.yt_video_links (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null default auth.uid() references auth.users(id) on delete cascade,
  from_id    uuid not null references public.yt_videos(id) on delete cascade,
  to_id      uuid not null references public.yt_videos(id) on delete cascade,
  kind       text not null check (kind in ('series','follow_up','watch_next')),
  note       text,
  position   integer not null default 0,
  created_at timestamptz not null default now(),
  check (from_id <> to_id)
);
create unique index if not exists yt_video_links_uq on public.yt_video_links (from_id, to_id, kind);
create index if not exists yt_video_links_to_idx on public.yt_video_links (to_id);

-- Row level security: each user sees only their own rows
do $$
declare t text;
begin
  foreach t in array array['yt_settings','yt_videos','yt_video_links'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists "own rows" on public.%I', t);
    execute format('create policy "own rows" on public.%I for all to authenticated using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()))', t);
  end loop;
end $$;
