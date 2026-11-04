-- Personal OS - 0036: YouTube Pipeline add-on (6 of 6) — system
--  · yt_oauth      Google sign-in tokens (ENCRYPTED by the server with YT_TOKEN_KEY). The browser can NEVER read
--                  this table: RLS is on with no policy and the anon/authenticated roles have no rights.
--                  Only the server, with the secret key (createAdminClient), reads and writes it.
--  · yt_oauth_status()  safe status for the page (connected? channel, expiry) — no tokens.
--  · yt_api_cache  cached YouTube API answers (per user, with expiry)
--  · yt_quota      YouTube API units used per day (the quota day resets at midnight Pacific time)
-- Needs 0031. Safe to run twice.

create table if not exists public.yt_oauth (
  user_id            uuid primary key references auth.users(id) on delete cascade,
  google_sub         text,
  channel_id         text,
  channel_title      text,
  access_token_enc   text,
  refresh_token_enc  text,
  expires_at         timestamptz,
  scopes             text[] not null default '{}',
  connected_at       timestamptz not null default now(),
  last_refresh_at    timestamptz,
  last_error         text,
  updated_at         timestamptz not null default now()
);
alter table public.yt_oauth enable row level security;
drop policy if exists "own rows" on public.yt_oauth;
revoke all on public.yt_oauth from anon, authenticated;
drop trigger if exists yt_oauth_touch on public.yt_oauth;
create trigger yt_oauth_touch before update on public.yt_oauth for each row execute function public.yt_touch();

create or replace function public.yt_oauth_status()
returns table (connected boolean, channel_id text, channel_title text, scopes text[], expires_at timestamptz, connected_at timestamptz, last_refresh_at timestamptz, last_error text)
language sql stable security definer set search_path = public as $$
  select (o.refresh_token_enc is not null), o.channel_id, o.channel_title, o.scopes, o.expires_at, o.connected_at, o.last_refresh_at, o.last_error
  from public.yt_oauth o where o.user_id = auth.uid();
$$;
revoke all on function public.yt_oauth_status() from public, anon;
grant execute on function public.yt_oauth_status() to authenticated;

create table if not exists public.yt_api_cache (
  user_id     uuid not null default auth.uid() references auth.users(id) on delete cascade,
  key         text not null,
  data        jsonb not null,
  fetched_at  timestamptz not null default now(),
  expires_at  timestamptz,
  primary key (user_id, key)
);
create index if not exists yt_api_cache_expiry_idx on public.yt_api_cache (expires_at);

create table if not exists public.yt_quota (
  user_id      uuid not null default auth.uid() references auth.users(id) on delete cascade,
  day          date not null,
  units        integer not null default 0,
  search_calls integer not null default 0,
  primary key (user_id, day)
);

do $$
declare t text;
begin
  foreach t in array array['yt_api_cache','yt_quota'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists "own rows" on public.%I', t);
    execute format('create policy "own rows" on public.%I for all to authenticated using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()))', t);
  end loop;
end $$;
