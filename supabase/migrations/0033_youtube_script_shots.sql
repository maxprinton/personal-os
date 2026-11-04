-- Personal OS - 0033: YouTube Pipeline add-on (3 of 6) — outline, script, intro, shots, filming
--  · yt_sections          outline parts = script pages (intro | body | closing). num = fixed number once the
--                         outline is locked (Intro S00, Closing S99, body S01…). content = Markdown (Notes editor).
--                         Intro fields: intro_status, intro_guides, watch_checks.
--  · yt_outline_templates the user's own outline templates per format (built-in ones live in code)
--  · yt_cues              edit cues marked on the script: music | sfx | cut | zoom (not script text)
--  · yt_script_exports    each "Export to Notes" (note + version)
--  · yt_shots             shot list (kinds AR BR SC GR ST PH VT), filming mode, pickups
--  · yt_moments           moments logged while filming (feed the intro)
-- Needs 0031. Safe to run twice.

create table if not exists public.yt_sections (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null default auth.uid() references auth.users(id) on delete cascade,
  video_id      uuid not null references public.yt_videos(id) on delete cascade,
  kind          text not null default 'body' check (kind in ('intro','body','closing')),
  num           integer check (num is null or num between 0 and 99),
  title         text not null default '',
  description   text,
  position      integer not null default 0,
  is_climax     boolean not null default false,
  content       text not null default '',
  words         integer not null default 0,
  card_ids      uuid[] not null default '{}',
  energy        integer check (energy is null or energy between 1 and 5),
  start_s       integer check (start_s is null or start_s >= 0),
  intro_status  text not null default 'not_written' check (intro_status in ('not_written','draft','final','filmed')),
  intro_guides  jsonb not null default '{}'::jsonb,
  watch_checks  integer not null default 0 check (watch_checks between 0 and 10),
  watch_notes   text,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create index if not exists yt_sections_video_idx on public.yt_sections (video_id, position);
create unique index if not exists yt_sections_intro_uq on public.yt_sections (video_id) where kind = 'intro';
create unique index if not exists yt_sections_closing_uq on public.yt_sections (video_id) where kind = 'closing';
create unique index if not exists yt_sections_climax_uq on public.yt_sections (video_id) where is_climax;
create unique index if not exists yt_sections_num_uq on public.yt_sections (video_id, num) where num is not null;
drop trigger if exists yt_sections_touch on public.yt_sections;
create trigger yt_sections_touch before update on public.yt_sections for each row execute function public.yt_touch();

create table if not exists public.yt_outline_templates (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null default auth.uid() references auth.users(id) on delete cascade,
  format      text not null,
  name        text not null,
  sections    jsonb not null default '[]'::jsonb,
  position    integer not null default 0,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index if not exists yt_outline_templates_user_idx on public.yt_outline_templates (user_id, format, position);
drop trigger if exists yt_outline_templates_touch on public.yt_outline_templates;
create trigger yt_outline_templates_touch before update on public.yt_outline_templates for each row execute function public.yt_touch();

create table if not exists public.yt_cues (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null default auth.uid() references auth.users(id) on delete cascade,
  video_id     uuid not null references public.yt_videos(id) on delete cascade,
  section_id   uuid not null references public.yt_sections(id) on delete cascade,
  block_id     text,
  anchor_text  text,
  kind         text not null check (kind in ('music','sfx','cut','zoom')),
  text         text,
  mood         text,
  energy       integer check (energy is null or energy between 1 and 5),
  at_s         integer check (at_s is null or at_s >= 0),
  position     integer not null default 0,
  created_at   timestamptz not null default now()
);
create index if not exists yt_cues_video_idx on public.yt_cues (video_id, section_id, position);

create table if not exists public.yt_script_exports (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null default auth.uid() references auth.users(id) on delete cascade,
  video_id     uuid not null references public.yt_videos(id) on delete cascade,
  note_id      uuid references public.notes(id) on delete set null,
  version      integer not null default 1,
  title        text,
  exported_at  timestamptz not null default now()
);
create index if not exists yt_script_exports_video_idx on public.yt_script_exports (video_id, version desc);

create table if not exists public.yt_shots (
  id                uuid primary key default gen_random_uuid(),
  user_id           uuid not null default auth.uid() references auth.users(id) on delete cascade,
  video_id          uuid not null references public.yt_videos(id) on delete cascade,
  section_id        uuid references public.yt_sections(id) on delete set null,
  block_id          text,
  para_hash         text,
  line_text         text,
  num               integer,
  kind              text not null default 'AR' check (kind in ('AR','BR','SC','GR','ST','PH','VT')),
  description       text,
  framing           text,
  angle             text,
  movement          text,
  location          text,
  setup             text,
  props             text,
  lighting          text,
  outfit            text,
  duration_s        numeric,
  audio             text,
  edit_notes        text,
  done              boolean not null default false,
  done_at           timestamptz,
  script_changed    boolean not null default false,
  is_pickup         boolean not null default false,
  matches_thumbnail boolean not null default false,
  ai_suggested      boolean not null default false,
  position          integer not null default 0,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);
create index if not exists yt_shots_video_idx on public.yt_shots (video_id, section_id, position);
create index if not exists yt_shots_missing_idx on public.yt_shots (user_id, setup) where done = false;
drop trigger if exists yt_shots_touch on public.yt_shots;
create trigger yt_shots_touch before update on public.yt_shots for each row execute function public.yt_touch();

create table if not exists public.yt_moments (
  id             uuid primary key default gen_random_uuid(),
  user_id        uuid not null default auth.uid() references auth.users(id) on delete cascade,
  video_id       uuid not null references public.yt_videos(id) on delete cascade,
  shot_id        uuid references public.yt_shots(id) on delete set null,
  text           text not null,
  kind           text not null default 'other' check (kind in ('funny','fail','reveal','effort','other')),
  at             timestamptz not null default now(),
  used_in_intro  boolean not null default false,
  created_at     timestamptz not null default now()
);
create index if not exists yt_moments_video_idx on public.yt_moments (video_id, at);

do $$
declare t text;
begin
  foreach t in array array['yt_sections','yt_outline_templates','yt_cues','yt_script_exports','yt_shots','yt_moments'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists "own rows" on public.%I', t);
    execute format('create policy "own rows" on public.%I for all to authenticated using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()))', t);
  end loop;
end $$;
