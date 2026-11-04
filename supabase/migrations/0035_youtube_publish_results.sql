-- Personal OS - 0035: YouTube Pipeline add-on (5 of 6) — publishing, A/B tests, follow-ups, watchlist, weekly
--  · yt_publish        the publish package of a video (one row per video): API fields, translations, chapters,
--                      playlists, captions from the script, manual Studio checklist
--  · yt_tests          A/B tests: test_compare (YouTube Studio, manual) | swap (before/after change at 48 h)
--  · yt_checkins       follow-ups at 48h / 7d / 30d / 90d with metrics, baseline and verdict
--  · yt_postmortems    AI post-mortem (saved also as a note)
--  · yt_comments_todo  comments to answer (or turn into ideas)
--  · yt_watch_channels channels to watch (checked once a week)
--  · yt_watch_outliers "New outliers" inbox found in watched channels
--  · yt_weekly         weekly channel reviews (Telegram + note)
-- Needs 0031 and 0032. Safe to run twice.

create table if not exists public.yt_publish (
  id                 uuid primary key default gen_random_uuid(),
  user_id            uuid not null default auth.uid() references auth.users(id) on delete cascade,
  video_id           uuid not null references public.yt_videos(id) on delete cascade,
  youtube_video_id   text,
  fields             jsonb not null default '{}'::jsonb,
  localizations      jsonb not null default '{}'::jsonb,
  chapters           jsonb not null default '[]'::jsonb,
  playlists          text[] not null default '{}',
  captions           jsonb not null default '{}'::jsonb,
  captions_pushed    boolean not null default false,
  captions_pushed_at timestamptz,
  checklist          jsonb not null default '{}'::jsonb,
  pinned_comment     text,
  post_plan          jsonb not null default '{}'::jsonb,
  scheduled_at       timestamptz,
  pushed_at          timestamptz,
  push_log           jsonb not null default '[]'::jsonb,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);
create unique index if not exists yt_publish_video_uq on public.yt_publish (video_id);
drop trigger if exists yt_publish_touch on public.yt_publish;
create trigger yt_publish_touch before update on public.yt_publish for each row execute function public.yt_touch();

create table if not exists public.yt_tests (
  id              uuid primary key default gen_random_uuid(),
  user_id         uuid not null default auth.uid() references auth.users(id) on delete cascade,
  video_id        uuid not null references public.yt_videos(id) on delete cascade,
  kind            text not null check (kind in ('test_compare','swap')),
  pair_ids        uuid[] not null default '{}',
  from_pair_id    uuid references public.yt_pairs(id) on delete set null,
  to_pair_id      uuid references public.yt_pairs(id) on delete set null,
  winner_pair_id  uuid references public.yt_pairs(id) on delete set null,
  started_at      timestamptz not null default now(),
  ended_at        timestamptz,
  verdict         text check (verdict in ('winner','same','inconclusive','no_clear_difference')),
  metrics_before  jsonb not null default '{}'::jsonb,
  metrics_after   jsonb not null default '{}'::jsonb,
  attrs           jsonb not null default '{}'::jsonb,
  notes           text,
  created_at      timestamptz not null default now()
);
create index if not exists yt_tests_video_idx on public.yt_tests (video_id, started_at desc);
create index if not exists yt_tests_open_idx on public.yt_tests (user_id) where ended_at is null;

create table if not exists public.yt_checkins (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null default auth.uid() references auth.users(id) on delete cascade,
  video_id     uuid not null references public.yt_videos(id) on delete cascade,
  kind         text not null check (kind in ('48h','7d','30d','90d')),
  due_at       timestamptz not null,
  done_at      timestamptz,
  metrics      jsonb not null default '{}'::jsonb,
  baseline     jsonb not null default '{}'::jsonb,
  verdict      text check (verdict in ('above','normal','below','insufficient')),
  notified_at  timestamptz,
  notes        text,
  created_at   timestamptz not null default now()
);
create unique index if not exists yt_checkins_uq on public.yt_checkins (video_id, kind);
create index if not exists yt_checkins_due_idx on public.yt_checkins (user_id, due_at) where done_at is null;

create table if not exists public.yt_postmortems (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null default auth.uid() references auth.users(id) on delete cascade,
  video_id    uuid not null references public.yt_videos(id) on delete cascade,
  checkin_id  uuid references public.yt_checkins(id) on delete set null,
  text        text not null default '',
  note_id     uuid references public.notes(id) on delete set null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index if not exists yt_postmortems_video_idx on public.yt_postmortems (video_id, created_at desc);
drop trigger if exists yt_postmortems_touch on public.yt_postmortems;
create trigger yt_postmortems_touch before update on public.yt_postmortems for each row execute function public.yt_touch();

create table if not exists public.yt_comments_todo (
  id             uuid primary key default gen_random_uuid(),
  user_id        uuid not null default auth.uid() references auth.users(id) on delete cascade,
  video_id       uuid not null references public.yt_videos(id) on delete cascade,
  comment_id     text,
  text           text not null,
  author         text,
  like_count     integer,
  published_at   timestamptz,
  answered       boolean not null default false,
  idea_video_id  uuid references public.yt_videos(id) on delete set null,
  created_at     timestamptz not null default now()
);
create unique index if not exists yt_comments_todo_uq on public.yt_comments_todo (video_id, comment_id) where comment_id is not null;
create index if not exists yt_comments_todo_open_idx on public.yt_comments_todo (user_id) where answered = false;

create table if not exists public.yt_watch_channels (
  id              uuid primary key default gen_random_uuid(),
  user_id         uuid not null default auth.uid() references auth.users(id) on delete cascade,
  channel_id      text not null,
  handle          text,
  title           text not null default '',
  url             text,
  thumbnail_url   text,
  subs            bigint,
  median_views    bigint,
  active          boolean not null default true,
  last_checked_at timestamptz,
  last_upload_at  timestamptz,
  notes           text,
  created_at      timestamptz not null default now()
);
create unique index if not exists yt_watch_channels_uq on public.yt_watch_channels (user_id, channel_id);

create table if not exists public.yt_watch_outliers (
  id              uuid primary key default gen_random_uuid(),
  user_id         uuid not null default auth.uid() references auth.users(id) on delete cascade,
  channel_row_id  uuid references public.yt_watch_channels(id) on delete cascade,
  yt_id           text not null,
  title           text not null default '',
  url             text,
  thumbnail_url   text,
  views           bigint,
  channel_median  bigint,
  outlier_score   numeric,
  published_at    timestamptz,
  status          text not null default 'new' check (status in ('new','saved','idea','dismissed')),
  video_id        uuid references public.yt_videos(id) on delete set null,
  found_at        timestamptz not null default now()
);
create unique index if not exists yt_watch_outliers_uq on public.yt_watch_outliers (user_id, yt_id);
create index if not exists yt_watch_outliers_new_idx on public.yt_watch_outliers (user_id, found_at desc) where status = 'new';

create table if not exists public.yt_weekly (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null default auth.uid() references auth.users(id) on delete cascade,
  week_start  date not null,
  summary     text not null default '',
  data        jsonb not null default '{}'::jsonb,
  note_id     uuid references public.notes(id) on delete set null,
  sent_at     timestamptz,
  created_at  timestamptz not null default now()
);
create unique index if not exists yt_weekly_uq on public.yt_weekly (user_id, week_start);

do $$
declare t text;
begin
  foreach t in array array['yt_publish','yt_tests','yt_checkins','yt_postmortems','yt_comments_todo','yt_watch_channels','yt_watch_outliers','yt_weekly'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists "own rows" on public.%I', t);
    execute format('create policy "own rows" on public.%I for all to authenticated using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()))', t);
  end loop;
end $$;
