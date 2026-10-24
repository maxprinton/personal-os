-- Personal OS - Calendar v2, phase 4: habits live inside blocks.
--   habits        a habit belongs to a block type (null = "unscheduled" list until placed)
--   habit_checks  one mark per habit per block occurrence: done | skipped | missed
--                 (the same block twice in a day = two separate marks)
-- Copies the old "Track as habit" time blocks and their activity_logs history.
-- Rewrites generate_insights() to read the new tables. Requires 0007. Safe to run twice.

do $$ begin
  create type habit_check_state as enum ('done', 'skipped', 'missed');
exception when duplicate_object then null; end $$;

create table if not exists public.habits (
  id                    uuid primary key default gen_random_uuid(),
  user_id               uuid not null default auth.uid() references auth.users(id) on delete cascade,
  block_type_id         uuid references public.block_types(id) on delete set null,
  name                  text not null check (length(trim(name)) > 0),
  active_from           date not null default current_date,
  legacy_time_block_id  uuid references public.time_blocks(id) on delete set null,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),
  deleted_at            timestamptz
);
create index if not exists habits_user_type_idx on public.habits (user_id, block_type_id) where deleted_at is null;

create table if not exists public.habit_checks (
  id             uuid primary key default gen_random_uuid(),
  user_id        uuid not null default auth.uid() references auth.users(id) on delete cascade,
  habit_id       uuid not null references public.habits(id) on delete cascade,
  occurrence_id  uuid not null references public.block_occurrences(id) on delete cascade,
  date           date not null,                       -- the occurrence's date (for fast queries)
  state          habit_check_state not null,
  source         text not null default 'web',         -- web | telegram | auto (end of day) | import
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  constraint habit_checks_habit_occurrence_uq unique (habit_id, occurrence_id)
);
create index if not exists habit_checks_user_date_idx on public.habit_checks (user_id, date);

-- Days already closed (missed marks written, statuses computed) by the end-of-day routine
alter table public.user_settings add column if not exists calendar_closed_through date;

do $$
declare t text;
begin
  foreach t in array array['habits', 'habit_checks'] loop
    execute format('drop trigger if exists %I on public.%I', t || '_updated_at', t);
    execute format('create trigger %I before update on public.%I
                    for each row execute function public.set_updated_at()', t || '_updated_at', t);
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists "own rows" on public.%I', t);
    execute format('create policy "own rows" on public.%I for all to authenticated
                    using (user_id = (select auth.uid()))
                    with check (user_id = (select auth.uid()))', t);
  end loop;
end $$;

-- ---------- Copy old habit blocks + their history ------------------------
do $$
declare
  b    record;
  l    record;
  bt   uuid;
  h    uuid;
  sl   record;
  occ  uuid;
begin
  for b in select * from public.time_blocks where is_habit and deleted_at is null loop
    if exists (select 1 from public.habits where legacy_time_block_id = b.id) then
      continue;
    end if;
    select block_type_id into bt from public.block_slots where legacy_time_block_id = b.id limit 1;
    if bt is null then
      continue;  -- 0007 did not copy this block (no valid weekday)
    end if;
    insert into public.habits (user_id, block_type_id, name, active_from, legacy_time_block_id)
    values (b.user_id, bt, trim(b.title), b.valid_from, b.id)
    returning id into h;

    for l in
      select * from public.activity_logs
       where entity_type = 'time_block' and entity_id = b.id and deleted_at is null
    loop
      select * into sl from public.block_slots
       where legacy_time_block_id = b.id and weekday = extract(isodow from l.log_date)::int
       limit 1;
      if sl.id is null then
        continue;
      end if;
      insert into public.block_occurrences
        (user_id, block_type_id, slot_id, origin_date, date, start_time, end_time, status)
      values
        (b.user_id, bt, sl.id, l.log_date, l.log_date, sl.start_time, sl.end_time,
         case when l.status = 'completed' then 'done'::block_occurrence_status else 'scheduled'::block_occurrence_status end)
      on conflict (slot_id, origin_date) do update set status = excluded.status
      returning id into occ;

      insert into public.habit_checks (user_id, habit_id, occurrence_id, date, state, source)
      values (b.user_id, h, occ, l.log_date,
              case l.status when 'completed' then 'done'::habit_check_state
                            when 'skipped'   then 'skipped'::habit_check_state
                            else 'missed'::habit_check_state end,
              'import')
      on conflict (habit_id, occurrence_id) do nothing;
    end loop;
  end loop;
end $$;

-- ---------- Weekly insights read habits from the new tables ---------------
create or replace function public.generate_insights(p_user uuid default null, p_force boolean default false)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  u record;
  r record;
  n integer := 0;
  v_today date;
  v_month_start date;
  v_tasks_done integer;
  v_habits_done integer;
  v_spent numeric;
  v_titles text;
  v_count integer;
begin
  for u in
    select s.user_id, s.timezone from public.user_settings s
     where p_user is null or s.user_id = p_user
  loop
    v_today := (now() at time zone u.timezone)::date;
    v_month_start := date_trunc('month', v_today)::date;

    if p_force then
      update public.system_insights set deleted_at = now()
       where user_id = u.user_id and deleted_at is null
         and (generated_at at time zone u.timezone)::date = v_today;
    elsif exists (
      select 1 from public.system_insights
       where user_id = u.user_id and deleted_at is null
         and (generated_at at time zone u.timezone)::date = v_today
    ) then
      continue;
    end if;

    select count(*) into v_tasks_done from public.tasks
     where user_id = u.user_id and deleted_at is null and status = 'completed'
       and completed_at >= now() - interval '7 days';
    select count(*) into v_habits_done from public.habit_checks
     where user_id = u.user_id and state = 'done' and date > v_today - 7;
    select coalesce(sum(amount), 0) into v_spent from public.transactions
     where user_id = u.user_id and deleted_at is null and type = 'expense'
       and occurred_at >= now() - interval '7 days';
    insert into public.system_insights (user_id, insight_type, message)
    values (u.user_id, 'summary',
      format('Last 7 days: %s tasks done, %s habit check-ins, $%s spent.',
             v_tasks_done, v_habits_done, to_char(v_spent, 'FM999,999,990.00')));
    n := n + 1;

    select count(*), string_agg(title, ', ' order by rolled_over_count desc)
      into v_count, v_titles
      from (select title, rolled_over_count from public.tasks
             where user_id = u.user_id and deleted_at is null and status = 'pending'
               and rolled_over_count >= 3
             order by rolled_over_count desc limit 3) t;
    if v_count > 0 then
      insert into public.system_insights (user_id, insight_type, message)
      values (u.user_id, 'warning',
        format('You keep moving: %s. Break them down, give them a home block, or drop them.', v_titles));
      n := n + 1;
    end if;

    select count(*) into v_count from public.tasks
     where user_id = u.user_id and deleted_at is null and status = 'backlog'
       and updated_at < now() - interval '14 days';
    if v_count >= 3 then
      insert into public.system_insights (user_id, insight_type, message)
      values (u.user_id, 'pattern',
        format('%s backlog tasks have not moved in 2+ weeks. A 10-minute review could clear them.', v_count));
      n := n + 1;
    end if;

    -- Habits below 50%% in the last 7 days (free days and skips do not count)
    for r in
      select h.name,
             count(*) filter (where c.state = 'done')   as done,
             count(*) filter (where c.state <> 'skipped') as due
        from public.habits h
        join public.habit_checks c on c.habit_id = h.id and c.date > v_today - 7 and c.date < v_today
       where h.user_id = u.user_id and h.deleted_at is null
       group by h.id, h.name
    loop
      if r.due > 0 and r.done * 2 < r.due then
        insert into public.system_insights (user_id, insight_type, message)
        values (u.user_id, 'warning',
          format('"%s" was done %s of %s times this week. Is its block still at the right time?', r.name, r.done, r.due));
        n := n + 1;
      end if;
    end loop;

    for r in
      select c.name, bu.limit_amount,
             (select coalesce(sum(t.amount), 0) from public.transactions t
               where t.user_id = u.user_id and t.deleted_at is null and t.type = 'expense'
                 and t.category_id = bu.category_id
                 and (t.occurred_at at time zone u.timezone)::date >= v_month_start) as spent
        from public.budgets bu
        join public.categories c on c.id = bu.category_id
       where bu.user_id = u.user_id and bu.deleted_at is null and bu.period = 'monthly'
    loop
      if r.spent > r.limit_amount then
        insert into public.system_insights (user_id, insight_type, message)
        values (u.user_id, 'warning',
          format('%s budget is over: $%s of $%s this month.', r.name,
                 to_char(r.spent, 'FM999,999,990.00'), to_char(r.limit_amount, 'FM999,999,990.00')));
        n := n + 1;
      end if;
    end loop;
  end loop;
  return n;
end $$;

revoke execute on function public.generate_insights(uuid, boolean) from public, anon, authenticated;
