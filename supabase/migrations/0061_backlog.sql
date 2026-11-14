-- Personal OS - 0061: Backlog (features, improvements, bugs, big ideas) with the flow rules enforced in the database.
-- Flow: inbox -> later -> next -> now -> verifying -> done. Rejected ideas go to parked (with a reason).
-- The rules live in a trigger, so they hold for the web app, the Telegram bot AND Claude writing through SQL:
--   * Next needs a size. Now needs a size and a spec link (bugs are exempt).
--   * Now holds at most now_cap (2) items; bugs and reopened items bypass the cap.
--   * Next holds at most next_cap (5); Verifying holds at most verifying_cap (3).
--   * Parked needs a reason. Done is reached only through Verifying.
-- Every status change is logged in backlog_events. Additive and safe to run twice.

-- ---------- settings (one row per user; the trigger falls back to the defaults when there is no row) ----------
create table if not exists public.backlog_settings (
  user_id         uuid primary key default auth.uid() references auth.users(id) on delete cascade,
  now_cap         integer not null default 2 check (now_cap between 1 and 10),
  next_cap        integer not null default 5 check (next_cap between 1 and 50),
  verifying_cap   integer not null default 3 check (verifying_cap between 1 and 20),
  verify_days     integer not null default 7 check (verify_days between 1 and 60),
  triage_prompt   boolean not null default true,
  monday_summary  boolean not null default true,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

-- ---------- items ----------
create table if not exists public.backlog_items (
  id               uuid primary key default gen_random_uuid(),
  user_id          uuid not null default auth.uid() references auth.users(id) on delete cascade,
  number           bigint generated always as identity,
  title            text not null check (length(btrim(title)) between 1 and 200),
  type             text not null default 'feature' check (type in ('feature', 'improvement', 'bug', 'big_idea')),
  status           text not null default 'inbox'
                     check (status in ('inbox', 'later', 'next', 'now', 'verifying', 'done', 'parked')),
  size             text check (size in ('S', 'M', 'L')),
  area             text,
  spec_link        text,
  notes            text,
  parked_reason    text,
  value            smallint check (value between 1 and 3),
  effort           smallint check (effort between 1 and 3),
  position         double precision not null default 0,
  source           text not null default 'web' check (source in ('telegram', 'web', 'claude', 'import')),
  reopened_count   integer not null default 0,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  status_changed_at timestamptz not null default now(),
  verifying_since  timestamptz,
  done_at          timestamptz,
  deleted_at       timestamptz
);
create unique index if not exists backlog_items_number_idx on public.backlog_items (number);
create index if not exists backlog_items_user_status_idx
  on public.backlog_items (user_id, status, position) where deleted_at is null;

-- ---------- events (history) ----------
create table if not exists public.backlog_events (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null default auth.uid() references auth.users(id) on delete cascade,
  item_id      uuid not null references public.backlog_items(id) on delete cascade,
  from_status  text,
  to_status    text not null,
  at           timestamptz not null default now(),
  by           text not null default 'user' check (by in ('user', 'claude', 'system')),
  note         text
);
create index if not exists backlog_events_item_idx on public.backlog_events (item_id, at);
create index if not exists backlog_events_user_idx on public.backlog_events (user_id, at);

-- ---------- rules (BEFORE): transitions, guards, caps, timestamps, position ----------
create or replace function public.backlog_guard()
returns trigger language plpgsql as $$
declare
  v_now_cap  integer;
  v_next_cap integer;
  v_ver_cap  integer;
  v_pair     text;
  v_count    integer;
  v_reopen   boolean := false;
  v_max      double precision;
begin
  new.title := btrim(new.title);

  if tg_op = 'UPDATE' and new.status is not distinct from old.status then
    return new;
  end if;

  v_now_cap  := coalesce((select s.now_cap       from public.backlog_settings s where s.user_id = new.user_id), 2);
  v_next_cap := coalesce((select s.next_cap      from public.backlog_settings s where s.user_id = new.user_id), 5);
  v_ver_cap  := coalesce((select s.verifying_cap from public.backlog_settings s where s.user_id = new.user_id), 3);

  if tg_op = 'INSERT' then
    if new.status not in ('inbox', 'later', 'next', 'now', 'parked') then
      raise exception 'New items can start in inbox, later, next, now or parked, not %.', new.status;
    end if;
  else
    v_pair := old.status || '>' || new.status;
    if not (v_pair = any (array[
      'inbox>later', 'inbox>next', 'inbox>now', 'inbox>parked',
      'later>next', 'later>now', 'later>parked', 'later>inbox',
      'next>now', 'next>later', 'next>parked',
      'now>verifying', 'now>next', 'now>later', 'now>parked',
      'verifying>done', 'verifying>now', 'verifying>parked',
      'done>now', 'done>parked',
      'parked>inbox', 'parked>later'
    ])) then
      raise exception 'Cannot move from % to %.', old.status, new.status;
    end if;
    v_reopen := v_pair in ('verifying>now', 'done>now');
  end if;

  -- size before next; size before now (bugs are exempt from the size and spec rules for now)
  if new.status in ('next', 'now') and new.size is null and not (new.status = 'now' and new.type = 'bug') then
    raise exception 'Set a size (S, M or L) before moving it to %.', initcap(new.status);
  end if;
  if new.status = 'now' and new.type <> 'bug' and coalesce(btrim(new.spec_link), '') = '' then
    raise exception 'Add a spec link before moving it to Now.';
  end if;

  -- caps (bugs and reopened items bypass the Now cap; moving items down is never blocked by a cap)
  if new.status = 'now' and new.type <> 'bug' and not v_reopen then
    select count(*) into v_count from public.backlog_items i
      where i.user_id = new.user_id and i.status = 'now' and i.type <> 'bug'
        and i.deleted_at is null and i.id <> new.id;
    if v_count >= v_now_cap then
      raise exception 'Now already has % items. Finish, verify or move one first.', v_now_cap;
    end if;
  end if;
  if new.status = 'next' then
    select count(*) into v_count from public.backlog_items i
      where i.user_id = new.user_id and i.status = 'next' and i.deleted_at is null and i.id <> new.id;
    if v_count >= v_next_cap then
      raise exception 'Next already has % items. Move one first.', v_next_cap;
    end if;
  end if;
  if new.status = 'verifying' then
    select count(*) into v_count from public.backlog_items i
      where i.user_id = new.user_id and i.status = 'verifying' and i.deleted_at is null and i.id <> new.id;
    if v_count >= v_ver_cap then
      raise exception 'Verifying already has % items. Mark one done or reopen it first.', v_ver_cap;
    end if;
  end if;

  if new.status = 'parked' and coalesce(btrim(new.parked_reason), '') = '' then
    raise exception 'Give a reason before parking it.';
  end if;

  -- effects
  new.status_changed_at := now();
  if new.status = 'verifying' then
    new.verifying_since := now();
  else
    new.verifying_since := null;
  end if;
  if new.status = 'done' then
    new.done_at := now();
  else
    new.done_at := null;
  end if;
  if new.status <> 'parked' then
    new.parked_reason := null;
  end if;
  if v_reopen then
    new.reopened_count := coalesce(old.reopened_count, 0) + 1;
  end if;

  -- a moved (or new) item goes to the bottom of its column unless the caller set a position
  if (tg_op = 'INSERT' and new.position = 0) or (tg_op = 'UPDATE' and new.position = old.position) then
    select coalesce(max(i.position), 0) into v_max from public.backlog_items i
      where i.user_id = new.user_id and i.status = new.status and i.deleted_at is null and i.id <> new.id;
    new.position := v_max + 1;
  end if;

  return new;
end $$;

-- ---------- history (AFTER) ----------
create or replace function public.backlog_log()
returns trigger language plpgsql as $$
declare
  v_by   text := coalesce(nullif(current_setting('app.backlog_by', true), ''), 'user');
  v_note text := nullif(current_setting('app.backlog_note', true), '');
begin
  if v_by not in ('user', 'claude', 'system') then
    v_by := 'user';
  end if;
  if tg_op = 'INSERT' then
    insert into public.backlog_events (user_id, item_id, from_status, to_status, by, note)
      values (new.user_id, new.id, null, new.status, v_by, v_note);
  elsif new.status is distinct from old.status then
    insert into public.backlog_events (user_id, item_id, from_status, to_status, by, note)
      values (new.user_id, new.id, old.status, new.status, v_by, v_note);
  end if;
  return null;
end $$;

drop trigger if exists backlog_items_guard on public.backlog_items;
create trigger backlog_items_guard before insert or update on public.backlog_items
  for each row execute function public.backlog_guard();
drop trigger if exists backlog_items_log on public.backlog_items;
create trigger backlog_items_log after insert or update on public.backlog_items
  for each row execute function public.backlog_log();
drop trigger if exists backlog_items_updated_at on public.backlog_items;
create trigger backlog_items_updated_at before update on public.backlog_items
  for each row execute function public.set_updated_at();
drop trigger if exists backlog_settings_updated_at on public.backlog_settings;
create trigger backlog_settings_updated_at before update on public.backlog_settings
  for each row execute function public.set_updated_at();

-- ---------- RLS ----------
alter table public.backlog_settings enable row level security;
alter table public.backlog_items    enable row level security;
alter table public.backlog_events   enable row level security;
drop policy if exists "own rows" on public.backlog_settings;
create policy "own rows" on public.backlog_settings for all to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
drop policy if exists "own rows" on public.backlog_items;
create policy "own rows" on public.backlog_items for all to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
drop policy if exists "own rows" on public.backlog_events;
create policy "own rows" on public.backlog_events for all to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));

-- ---------- helpers for Claude (and anything else writing through SQL) ----------
-- backlog_add: one sentence into the Inbox. With no user given it uses the signed-in user, or the only user.
create or replace function public.backlog_add(
  p_title text,
  p_type text default 'feature',
  p_source text default 'claude',
  p_status text default 'inbox',
  p_area text default null,
  p_notes text default null,
  p_parked_reason text default null,
  p_user uuid default null
) returns public.backlog_items
language plpgsql as $$
declare
  r public.backlog_items;
  v_user uuid := coalesce(p_user, auth.uid(), (select u.id from auth.users u order by u.created_at limit 1));
begin
  perform set_config('app.backlog_by', case when p_source in ('claude', 'import') then 'claude' else 'user' end, true);
  insert into public.backlog_items (user_id, title, type, status, source, area, notes, parked_reason)
    values (v_user, p_title, p_type, p_status, p_source, p_area, p_notes, p_parked_reason)
    returning * into r;
  return r;
end $$;

-- backlog_move: change status by BL number; the trigger enforces every rule.
create or replace function public.backlog_move(
  p_number bigint,
  p_status text,
  p_by text default 'claude',
  p_note text default null,
  p_reason text default null,
  p_size text default null,
  p_spec_link text default null
) returns public.backlog_items
language plpgsql as $$
declare
  r public.backlog_items;
begin
  perform set_config('app.backlog_by', p_by, true);
  perform set_config('app.backlog_note', coalesce(p_note, ''), true);
  update public.backlog_items
     set status = p_status,
         parked_reason = coalesce(p_reason, parked_reason),
         size = coalesce(p_size, size),
         spec_link = coalesce(p_spec_link, spec_link)
   where number = p_number and deleted_at is null
   returning * into r;
  if not found then
    raise exception 'BL-% not found.', p_number;
  end if;
  return r;
end $$;

-- ---------- view Claude reads at the start of a session ----------
create or replace view public.backlog_overview with (security_invoker = true) as
select
  i.id,
  i.user_id,
  i.number,
  'BL-' || i.number as code,
  i.title,
  i.type,
  i.status,
  i.size,
  i.area,
  i.spec_link,
  i.position,
  i.reopened_count,
  floor(extract(epoch from (now() - i.status_changed_at)) / 86400)::integer as days_in_status,
  (i.status = 'verifying'
    and i.verifying_since is not null
    and now() - i.verifying_since >= make_interval(days => coalesce(
          (select s.verify_days from public.backlog_settings s where s.user_id = i.user_id), 7))) as verify_due
from public.backlog_items i
where i.deleted_at is null;

-- ---------- one settings row for existing users ----------
insert into public.backlog_settings (user_id)
  select u.id from auth.users u
  on conflict (user_id) do nothing;
