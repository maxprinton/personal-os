-- Personal OS - 0034: YouTube Pipeline add-on (4 of 6) — clips, editing, music
--  · yt_clips         one or more clips per shot (shot_id NULL = extra clip: stock, screen, image, meme…)
--  · yt_edit_passes   checklist of edit passes: rough_cut | annotation | broll | music | visual | sfx
--  · yt_cuts          exported versions (rough, v2, final…) with a link
--  · yt_review_notes  notes with a time on a version ("2:13 remove this pause")
--  · yt_music         music tracks used by the video (Music Lab recipe or a library track)
-- Video and music FILES are never stored here: only names, links/paths and recipes.
-- Needs 0031 and 0033. Safe to run twice.

create table if not exists public.yt_clips (
  id             uuid primary key default gen_random_uuid(),
  user_id        uuid not null default auth.uid() references auth.users(id) on delete cascade,
  video_id       uuid not null references public.yt_videos(id) on delete cascade,
  shot_id        uuid references public.yt_shots(id) on delete set null,
  file_name      text not null default '',
  original_name  text,
  location       text not null default 'pc' check (location in ('drive','pc','phone','other')),
  url_or_path    text,
  take           integer not null default 1 check (take >= 1),
  is_best        boolean not null default false,
  status         text not null default 'recorded' check (status in ('missing','recorded','imported','in_timeline')),
  kind           text,
  source         text,
  license        text,
  notes          text,
  position       integer not null default 0,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);
create index if not exists yt_clips_video_idx on public.yt_clips (video_id, shot_id, take);
drop trigger if exists yt_clips_touch on public.yt_clips;
create trigger yt_clips_touch before update on public.yt_clips for each row execute function public.yt_touch();

create table if not exists public.yt_edit_passes (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null default auth.uid() references auth.users(id) on delete cascade,
  video_id   uuid not null references public.yt_videos(id) on delete cascade,
  pass       text not null check (pass in ('rough_cut','annotation','broll','music','visual','sfx')),
  done_at    timestamptz,
  link       text,
  notes      text,
  created_at timestamptz not null default now()
);
create unique index if not exists yt_edit_passes_uq on public.yt_edit_passes (video_id, pass);

create table if not exists public.yt_cuts (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null default auth.uid() references auth.users(id) on delete cascade,
  video_id    uuid not null references public.yt_videos(id) on delete cascade,
  label       text not null default 'rough',
  url         text,
  duration_s  integer,
  notes       text,
  created_at  timestamptz not null default now()
);
create index if not exists yt_cuts_video_idx on public.yt_cuts (video_id, created_at);

create table if not exists public.yt_review_notes (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null default auth.uid() references auth.users(id) on delete cascade,
  video_id    uuid not null references public.yt_videos(id) on delete cascade,
  cut_id      uuid not null references public.yt_cuts(id) on delete cascade,
  at_seconds  integer not null default 0 check (at_seconds >= 0),
  text        text not null,
  resolved    boolean not null default false,
  created_at  timestamptz not null default now()
);
create index if not exists yt_review_notes_cut_idx on public.yt_review_notes (cut_id, at_seconds);

create table if not exists public.yt_music (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null default auth.uid() references auth.users(id) on delete cascade,
  video_id    uuid not null references public.yt_videos(id) on delete cascade,
  section_id  uuid references public.yt_sections(id) on delete set null,
  track       text not null,
  source      text not null default 'music_lab' check (source in ('music_lab','library','other')),
  license     text,
  file_name   text,
  recipe      jsonb,
  start_s     integer,
  end_s       integer,
  position    integer not null default 0,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index if not exists yt_music_video_idx on public.yt_music (video_id, position);
drop trigger if exists yt_music_touch on public.yt_music;
create trigger yt_music_touch before update on public.yt_music for each row execute function public.yt_touch();

do $$
declare t text;
begin
  foreach t in array array['yt_clips','yt_edit_passes','yt_cuts','yt_review_notes','yt_music'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists "own rows" on public.%I', t);
    execute format('create policy "own rows" on public.%I for all to authenticated using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()))', t);
  end loop;
end $$;
