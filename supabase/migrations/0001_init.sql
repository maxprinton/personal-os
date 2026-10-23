-- =====================================================================
-- Personal OS - Phase 1 schema (corrected)
-- Single user today, multi-user safe: every table has user_id + RLS.
-- Run once in Supabase > SQL Editor.
-- =====================================================================

create extension if not exists pgcrypto;

-- ---------- Enums ----------------------------------------------------
create type entity_type        as enum ('time_block', 'event', 'task', 'note');
create type relationship_type  as enum ('mentions', 'sub_item', 'blocks', 'fulfills');
create type task_status        as enum ('pending', 'completed', 'backlog', 'failed');
create type rollover_policy    as enum ('migrate', 'backlog', 'graveyard');
create type capture_source     as enum ('web', 'mobile', 'telegram_bot', 'import');
create type activity_status    as enum ('completed', 'skipped', 'failed');
create type transaction_type   as enum ('income', 'expense');
create type budget_period      as enum ('weekly', 'monthly');
create type account_kind       as enum ('checking', 'savings', 'credit_card', 'cash', 'other');
create type insight_type       as enum ('pattern', 'warning', 'summary');
create type bot_message_status as enum ('received', 'parsed', 'saved', 'failed', 'undone');

-- ---------- Helpers --------------------------------------------------
create or replace function public.set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end $$;

-- ---------- User settings --------------------------------------------
create table public.user_settings (
  user_id           uuid primary key references auth.users(id) on delete cascade,
  timezone          text not null default 'America/Guayaquil',
  currency          text not null default 'USD' check (currency = 'USD'),
  locale            text not null default 'en'  check (locale = 'en'),
  telegram_chat_id  bigint unique,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

-- Create settings automatically when a user signs up
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.user_settings (user_id) values (new.id) on conflict do nothing;
  return new;
end $$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ---------- Time: canvas vs reality ----------------------------------
create table public.time_blocks (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null default auth.uid() references auth.users(id) on delete cascade,
  title         text not null,
  start_time    time not null,
  end_time      time not null,
  rrule         text not null,                       -- RFC 5545, e.g. FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR
  timezone      text not null default 'America/Guayaquil',
  valid_from    date not null default current_date,
  valid_until   date,
  is_habit      boolean not null default false,
  color         text,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  deleted_at    timestamptz,
  check (end_time > start_time),
  check (valid_until is null or valid_until >= valid_from)
);

create table public.events (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null default auth.uid() references auth.users(id) on delete cascade,
  title         text not null,
  start_time    timestamptz not null,
  end_time      timestamptz not null,
  is_habit      boolean not null default false,
  source        capture_source not null default 'web',
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  deleted_at    timestamptz,
  check (end_time > start_time)
);

-- ---------- Tasks & notes --------------------------------------------
create table public.tasks (
  id                 uuid primary key default gen_random_uuid(),
  user_id            uuid not null default auth.uid() references auth.users(id) on delete cascade,
  title              text not null,
  status             task_status not null default 'pending',
  rollover_policy    rollover_policy not null default 'migrate',
  scheduled_for      date,                            -- null = unscheduled
  completed_at       timestamptz,
  rolled_over_count  integer not null default 0 check (rolled_over_count >= 0),
  is_habit           boolean not null default false,
  source             capture_source not null default 'web',
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  deleted_at         timestamptz,
  check ((status = 'completed') = (completed_at is not null))
);

create table public.notes (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null default auth.uid() references auth.users(id) on delete cascade,
  title       text not null default '',
  content     text not null default '',               -- Markdown
  source      capture_source not null default 'web',
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  deleted_at  timestamptz
);

-- ---------- Tags & relations (polymorphic) ---------------------------
create table public.tags (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null default auth.uid() references auth.users(id) on delete cascade,
  name        text not null,
  color       text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  deleted_at  timestamptz
);
create unique index tags_user_name_uq on public.tags (user_id, lower(name)) where deleted_at is null;

create table public.entity_tags (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null default auth.uid() references auth.users(id) on delete cascade,
  tag_id       uuid not null references public.tags(id) on delete cascade,
  entity_type  entity_type not null,
  entity_id    uuid not null,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  deleted_at   timestamptz
);
create unique index entity_tags_uq on public.entity_tags (tag_id, entity_type, entity_id) where deleted_at is null;

create table public.entity_relations (
  id                 uuid primary key default gen_random_uuid(),
  user_id            uuid not null default auth.uid() references auth.users(id) on delete cascade,
  source_type        entity_type not null,
  source_id          uuid not null,
  target_type        entity_type not null,
  target_id          uuid not null,
  relationship_type  relationship_type not null,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  deleted_at         timestamptz,
  check (not (source_type = target_type and source_id = target_id))
);
create unique index entity_relations_uq
  on public.entity_relations (source_type, source_id, target_type, target_id, relationship_type)
  where deleted_at is null;
create index entity_relations_target_idx on public.entity_relations (target_type, target_id);

-- Polymorphic integrity: the referenced row must exist and belong to the same user
create or replace function public.entity_exists(p_type entity_type, p_id uuid, p_user uuid)
returns boolean language plpgsql stable security definer set search_path = public as $$
declare found boolean;
begin
  execute format('select exists(select 1 from public.%I where id = $1 and user_id = $2)',
                 case p_type when 'time_block' then 'time_blocks'
                             when 'event'      then 'events'
                             when 'task'       then 'tasks'
                             when 'note'       then 'notes' end)
    into found using p_id, p_user;
  return found;
end $$;

create or replace function public.check_entity_refs()
returns trigger language plpgsql as $$
begin
  if tg_table_name = 'entity_relations' then
    if not public.entity_exists(new.source_type, new.source_id, new.user_id) then
      raise exception 'source % % not found', new.source_type, new.source_id;
    end if;
    if not public.entity_exists(new.target_type, new.target_id, new.user_id) then
      raise exception 'target % % not found', new.target_type, new.target_id;
    end if;
    if new.relationship_type = 'fulfills'
       and not (new.source_type = 'event' and new.target_type = 'time_block') then
      raise exception 'fulfills must link an event to a time_block';
    end if;
  else
    if not public.entity_exists(new.entity_type, new.entity_id, new.user_id) then
      raise exception '% % not found', new.entity_type, new.entity_id;
    end if;
  end if;
  return new;
end $$;

create trigger entity_relations_check before insert or update on public.entity_relations
  for each row execute function public.check_entity_refs();
create trigger entity_tags_check before insert or update on public.entity_tags
  for each row execute function public.check_entity_refs();

-- ---------- Habits & metrics -----------------------------------------
create table public.activity_logs (
  id                     uuid primary key default gen_random_uuid(),
  user_id                uuid not null default auth.uid() references auth.users(id) on delete cascade,
  entity_type            entity_type not null check (entity_type <> 'note'),
  entity_id              uuid not null,
  log_date               date not null,
  status                 activity_status not null,
  skip_reason            text,                         -- a justified skip keeps the streak
  fulfilled_by_event_id  uuid references public.events(id) on delete set null,
  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now(),
  deleted_at             timestamptz,
  check (status <> 'skipped' or skip_reason is not null)
);
create unique index activity_logs_uq on public.activity_logs (user_id, entity_type, entity_id, log_date)
  where deleted_at is null;

create trigger activity_logs_check before insert or update on public.activity_logs
  for each row execute function public.check_entity_refs();

create table public.metric_definitions (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null default auth.uid() references auth.users(id) on delete cascade,
  name        text not null,                           -- e.g. Water intake
  unit        text not null,                           -- e.g. L, 1-10
  min_value   numeric,
  max_value   numeric,
  daily_goal  numeric,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  deleted_at  timestamptz
);
create unique index metric_definitions_uq on public.metric_definitions (user_id, lower(name)) where deleted_at is null;

create table public.daily_metrics (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null default auth.uid() references auth.users(id) on delete cascade,
  metric_id   uuid not null references public.metric_definitions(id) on delete cascade,
  log_date    date not null,
  value       numeric not null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  deleted_at  timestamptz
);
create unique index daily_metrics_uq on public.daily_metrics (user_id, metric_id, log_date) where deleted_at is null;

-- ---------- Finance (USD only) ---------------------------------------
create table public.accounts (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null default auth.uid() references auth.users(id) on delete cascade,
  name        text not null,
  kind        account_kind not null default 'checking',
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  deleted_at  timestamptz
);

create table public.categories (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null default auth.uid() references auth.users(id) on delete cascade,
  name        text not null,
  kind        transaction_type not null,
  color       text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  deleted_at  timestamptz
);
create unique index categories_uq on public.categories (user_id, kind, lower(name)) where deleted_at is null;

create table public.transactions (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null default auth.uid() references auth.users(id) on delete cascade,
  account_id   uuid references public.accounts(id) on delete set null,
  category_id  uuid references public.categories(id) on delete set null,
  type         transaction_type not null,
  amount       numeric(12,2) not null check (amount > 0),   -- USD, always positive; type gives the sign
  description  text,
  occurred_at  timestamptz not null default now(),
  source       capture_source not null default 'web',
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  deleted_at   timestamptz
);
create index transactions_user_date_idx on public.transactions (user_id, occurred_at desc);

create table public.budgets (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null default auth.uid() references auth.users(id) on delete cascade,
  category_id   uuid not null references public.categories(id) on delete cascade,
  limit_amount  numeric(12,2) not null check (limit_amount > 0),
  period        budget_period not null default 'monthly',
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  deleted_at    timestamptz
);
create unique index budgets_uq on public.budgets (user_id, category_id, period) where deleted_at is null;

create table public.balance_snapshots (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null default auth.uid() references auth.users(id) on delete cascade,
  account_id   uuid not null references public.accounts(id) on delete cascade,
  amount       numeric(12,2) not null,                -- may be negative (credit cards)
  recorded_at  timestamptz not null default now(),
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  deleted_at   timestamptz
);
create index balance_snapshots_acct_idx on public.balance_snapshots (account_id, recorded_at desc);

-- ---------- Insights & bot -------------------------------------------
create table public.system_insights (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null default auth.uid() references auth.users(id) on delete cascade,
  insight_type  insight_type not null,
  message       text not null,
  generated_at  timestamptz not null default now(),
  is_read       boolean not null default false,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  deleted_at    timestamptz
);

create table public.bot_messages (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null default auth.uid() references auth.users(id) on delete cascade,
  raw_text     text not null,
  parsed       jsonb,
  status       bot_message_status not null default 'received',
  entity_type  text,                                  -- task | note | transaction
  entity_id    uuid,
  error        text,
  received_at  timestamptz not null default now(),
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  deleted_at   timestamptz
);

-- ---------- updated_at triggers + RLS on every table -----------------
do $$
declare t text;
begin
  foreach t in array array[
    'user_settings','time_blocks','events','tasks','notes','tags','entity_tags','entity_relations',
    'activity_logs','metric_definitions','daily_metrics','accounts','categories','transactions',
    'budgets','balance_snapshots','system_insights','bot_messages']
  loop
    execute format('create trigger %I before update on public.%I
                    for each row execute function public.set_updated_at()', t || '_updated_at', t);
    execute format('alter table public.%I enable row level security', t);
    execute format('create policy "own rows" on public.%I for all to authenticated
                    using (user_id = (select auth.uid()))
                    with check (user_id = (select auth.uid()))', t);
  end loop;
end $$;

-- Helpful indexes for sync and dashboards
create index time_blocks_user_idx on public.time_blocks (user_id) where deleted_at is null;
create index events_user_start_idx on public.events (user_id, start_time) where deleted_at is null;
create index tasks_user_sched_idx on public.tasks (user_id, status, scheduled_for) where deleted_at is null;
create index notes_user_updated_idx on public.notes (user_id, updated_at desc);
