-- Stubs so migration 0061 can run on a plain scratch Postgres (no Supabase). Used only by scripts/test-backlog-sql.mjs.
create schema if not exists auth;
create table if not exists auth.users (id uuid primary key, created_at timestamptz not null default now());
create or replace function auth.uid() returns uuid language sql stable as $$
  select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
$$;
do $$ begin
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then create role authenticated; end if;
end $$;
create or replace function public.set_updated_at() returns trigger language plpgsql as $$
begin new.updated_at := now(); return new; end $$;
insert into auth.users (id) values ('00000000-0000-0000-0000-000000000001') on conflict do nothing;
