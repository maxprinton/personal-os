-- Personal OS - 0042: Portfolio add-on (1 of N) — foundation
--  · portfolio_site            ONE row: public site settings (name, tagline, links, nav…). blocked_words stays private.
--  · portfolio_slots           owner-only: the places a page can live (home, about, now, uses, project, article)
--  · portfolio_page_versions   owner-only: full history (stage / publish / unpublish / rollback) with snapshots
--  · portfolio_pages           PUBLIC snapshot: one row per slot + language, readable only when is_live
--  · portfolio_videos          PUBLIC snapshot of finished long-form videos (yt_video_id never public)
--  · portfolio_inbox           owner-only: contact-form messages, written ONLY by the OS server (service key)
--  · portfolio_contact_hits    rate-limit counters, server-only (nobody but the service key can touch it)
--  · notes.portfolio_slot_id / portfolio_lang   link a note to a slot (like notes.block_name)
--  · storage bucket portfolio-media (public read, 10 MB per file; writes only by the OS server)
-- Additive: nothing existing is dropped or changed in meaning. Needs 0001 (set_updated_at), 0020 (notes), 0031 (yt_videos).
-- Safe to run twice.

-- ============ tables ============
create table if not exists public.portfolio_site (
  id                 uuid primary key default gen_random_uuid(),
  user_id            uuid not null unique default auth.uid() references auth.users(id) on delete cascade,
  name               text,
  tagline            jsonb not null default '{}'::jsonb,        -- {en:"…", es:"…"}
  avatar_url         text,
  links              jsonb not null default '[]'::jsonb,
  nav                jsonb not null default '[]'::jsonb,
  langs              text[] not null default '{en,es}',
  default_lang       text not null default 'en' check (default_lang in ('en','es')),
  contact_enabled    boolean not null default true,
  analytics_enabled  boolean not null default true,
  blocked_words      text[] not null default '{}',               -- PRIVATE: never granted to anon
  social_image_url   text,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);

create table if not exists public.portfolio_slots (
  id             uuid primary key default gen_random_uuid(),
  user_id        uuid not null default auth.uid() references auth.users(id) on delete cascade,
  kind           text not null check (kind in ('home','about','now','uses','project','article')),
  key            text not null check (length(trim(key)) > 0),    -- internal slug, unique per user + kind
  previous_keys  text[] not null default '{}',
  position       double precision not null default 0,
  featured       boolean not null default false,
  archived       boolean not null default false,
  meta           jsonb not null default '{}'::jsonb,             -- neutral: status, years, stack[], links[], video
  langs          jsonb not null default '{}'::jsonb,             -- per language: slug, summary, role, seo_title, seo_desc
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);
create unique index if not exists portfolio_slots_key_uq on public.portfolio_slots (user_id, kind, lower(key)) where not archived;
create index if not exists portfolio_slots_user_idx on public.portfolio_slots (user_id, kind, position);

create table if not exists public.portfolio_page_versions (
  id              uuid primary key default gen_random_uuid(),
  user_id         uuid not null default auth.uid() references auth.users(id) on delete cascade,
  slot_id         uuid not null references public.portfolio_slots(id) on delete cascade,
  lang            text not null check (lang in ('en','es')),
  version         integer not null check (version > 0),
  action          text not null check (action in ('stage','publish','unpublish','rollback')),
  source_note_id  uuid,                                           -- not a foreign key: history must outlive the note
  source_hash     text,                                           -- change detection
  snapshot        jsonb not null,                                 -- everything the public row will contain
  warnings        jsonb not null default '[]'::jsonb,
  created_at      timestamptz not null default now(),
  unique (slot_id, lang, version)
);
create index if not exists portfolio_page_versions_user_idx on public.portfolio_page_versions (user_id, slot_id, lang, version desc);

create table if not exists public.portfolio_pages (
  id               uuid primary key default gen_random_uuid(),
  user_id          uuid not null default auth.uid() references auth.users(id) on delete cascade,
  slot_id          uuid not null references public.portfolio_slots(id) on delete cascade,
  slot_key         text not null,
  kind             text not null check (kind in ('home','about','now','uses','project','article')),
  lang             text not null check (lang in ('en','es')),
  slug             text not null check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  title            text not null,
  summary          text,
  icon             text,
  cover_url        text,
  body_html        text not null,
  toc              jsonb not null default '[]'::jsonb,
  meta             jsonb not null default '{}'::jsonb,
  search_text      text not null default '',
  reading_minutes  integer,
  featured         boolean not null default false,
  position         double precision not null default 0,
  version          integer not null check (version > 0),
  is_live          boolean not null default false,
  published_at     timestamptz,
  updated_at       timestamptz not null default now(),
  unique (slot_id, lang),
  unique (lang, kind, slug)
);
create index if not exists portfolio_pages_live_idx on public.portfolio_pages (lang, kind, position) where is_live;

create table if not exists public.portfolio_videos (
  id                uuid primary key default gen_random_uuid(),
  user_id           uuid not null default auth.uid() references auth.users(id) on delete cascade,
  yt_video_id       uuid references public.yt_videos(id) on delete set null,   -- private link, never granted to anon
  youtube_video_id  text not null,
  title             jsonb not null,                                -- {en, es}
  description       jsonb not null default '{}'::jsonb,
  thumb_url         text,
  duration_s        integer,
  published_at      timestamptz,
  featured          boolean not null default false,
  position          double precision not null default 0,
  is_live           boolean not null default true,
  updated_at        timestamptz not null default now(),
  unique (user_id, youtube_video_id)
);

create table if not exists public.portfolio_inbox (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references auth.users(id) on delete cascade,   -- set explicitly by the server (no auth.uid())
  name          text,
  email         text,
  message       text not null,
  lang          text,
  ip_hash       text,
  spam_score    integer not null default 0,
  spam          boolean not null default false,
  read_at       timestamptz,
  handled_at    timestamptz,
  created_at    timestamptz not null default now()
);
create index if not exists portfolio_inbox_user_idx on public.portfolio_inbox (user_id, created_at desc);

create table if not exists public.portfolio_contact_hits (
  ip_hash     text not null,
  created_at  timestamptz not null default now()
);
create index if not exists portfolio_contact_hits_idx on public.portfolio_contact_hits (ip_hash, created_at desc);

-- ============ notes: link a note to a slot ============
alter table public.notes add column if not exists portfolio_slot_id uuid references public.portfolio_slots(id) on delete set null;
alter table public.notes add column if not exists portfolio_lang text;
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'notes_portfolio_lang_chk') then
    alter table public.notes add constraint notes_portfolio_lang_chk
      check ((portfolio_slot_id is null and portfolio_lang is null) or (portfolio_slot_id is not null and portfolio_lang in ('en','es')));
  end if;
end $$;
create unique index if not exists notes_portfolio_uq on public.notes (portfolio_slot_id, portfolio_lang)
  where deleted_at is null and portfolio_slot_id is not null;

-- ============ updated_at triggers ============
do $$
declare t text;
begin
  foreach t in array array['portfolio_site','portfolio_slots','portfolio_pages','portfolio_videos'] loop
    execute format('drop trigger if exists %I on public.%I', t || '_updated_at', t);
    execute format('create trigger %I before update on public.%I for each row execute function public.set_updated_at()', t || '_updated_at', t);
  end loop;
end $$;

-- ============ row level security: the owner sees only their rows ============
do $$
declare t text;
begin
  foreach t in array array['portfolio_site','portfolio_slots','portfolio_page_versions','portfolio_pages','portfolio_videos'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists "own rows" on public.%I', t);
    execute format('create policy "own rows" on public.%I for all to authenticated using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()))', t);
  end loop;
end $$;

-- inbox: the owner can read, mark read/handled and delete; nobody inserts except the server (service key bypasses RLS)
alter table public.portfolio_inbox enable row level security;
drop policy if exists "own rows read" on public.portfolio_inbox;
drop policy if exists "own rows update" on public.portfolio_inbox;
drop policy if exists "own rows delete" on public.portfolio_inbox;
create policy "own rows read"   on public.portfolio_inbox for select to authenticated using (user_id = (select auth.uid()));
create policy "own rows update" on public.portfolio_inbox for update to authenticated using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
create policy "own rows delete" on public.portfolio_inbox for delete to authenticated using (user_id = (select auth.uid()));

-- contact hits: RLS on, no policy at all -> only the service key can use it
alter table public.portfolio_contact_hits enable row level security;

-- ============ public (anon) access: explicit column grants only ============
revoke all on public.portfolio_site, public.portfolio_slots, public.portfolio_page_versions, public.portfolio_pages,
              public.portfolio_videos, public.portfolio_inbox, public.portfolio_contact_hits from anon;
revoke all on public.portfolio_contact_hits from authenticated;

grant select (id, name, tagline, avatar_url, links, nav, langs, default_lang, contact_enabled, analytics_enabled, social_image_url, updated_at)
  on public.portfolio_site to anon;
grant select (id, slot_id, slot_key, kind, lang, slug, title, summary, icon, cover_url, body_html, toc, meta, search_text,
              reading_minutes, featured, position, version, is_live, published_at, updated_at)
  on public.portfolio_pages to anon;
grant select (id, youtube_video_id, title, description, thumb_url, duration_s, published_at, featured, position, is_live, updated_at)
  on public.portfolio_videos to anon;

drop policy if exists "public read" on public.portfolio_site;
create policy "public read" on public.portfolio_site for select to anon using (true);
drop policy if exists "public read live" on public.portfolio_pages;
create policy "public read live" on public.portfolio_pages for select to anon using (is_live);
drop policy if exists "public read live" on public.portfolio_videos;
create policy "public read live" on public.portfolio_videos for select to anon using (is_live);

-- ============ storage: public bucket for published images ============
-- Public read by URL. No storage policies for authenticated: the OS server writes with the admin client
-- after checking the signed-in user. The private note-files bucket is not touched.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('portfolio-media', 'portfolio-media', true, 10485760,
        array['image/png','image/jpeg','image/webp','image/gif','image/avif','application/pdf'])
on conflict (id) do update set public = true, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;
