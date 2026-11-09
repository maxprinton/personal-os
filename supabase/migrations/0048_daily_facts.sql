-- Personal OS - daily_facts: one row per local day, rebuilt from the raw tables (they stay the source of truth).
-- Your typed inputs (mood, energy, bedtime, wake_at, highlight) live only here and are never overwritten by a refresh.
-- Already applied to Supabase on 2026-11-09 (migration name 0048_daily_facts); this file is the copy for the repo.
create table if not exists public.daily_facts (
  user_id            uuid not null references auth.users(id) on delete cascade,
  date               date not null,
  closed             boolean not null default false,
  computed_at        timestamptz not null default now(),
  formula_version    smallint not null default 1,
  is_free_day        boolean not null default false,
  blocks_planned     int not null default 0,
  blocks_done        int not null default 0,
  blocks_partial     int not null default 0,
  block_min_planned  int not null default 0,
  block_min_done     int not null default 0,
  by_block           jsonb not null default '{}'::jsonb,
  habits_due         int not null default 0,
  habits_done        int not null default 0,
  habits_skipped     int not null default 0,
  by_habit           jsonb not null default '{}'::jsonb,
  tasks_created      int not null default 0,
  tasks_completed    int not null default 0,
  tasks_archived     int not null default 0,
  tasks_moved        int not null default 0,
  tasks_skipped      int not null default 0,
  tasks_open_eod     int,
  tasks_stale_eod    int,
  spent              numeric not null default 0,
  earned             numeric not null default 0,
  adjustment         numeric not null default 0,
  tx_count           int not null default 0,
  spent_by_category  jsonb not null default '{}'::jsonb,
  balance_total      numeric,
  work_classes       int not null default 0,
  work_hours         numeric not null default 0,
  work_amount        numeric not null default 0,
  notes_created      int not null default 0,
  notes_from_bot     int not null default 0,
  words_new          int not null default 0,
  ai_calls           int not null default 0,
  ai_tokens          bigint not null default 0,
  mood               smallint check (mood between 1 and 10),
  energy             smallint check (energy between 1 and 10),
  bedtime            timestamptz,
  wake_at            timestamptz,
  highlight          text,
  primary key (user_id, date),
  constraint daily_facts_sleep_order check (bedtime is null or wake_at is null or bedtime <= wake_at)
);
comment on table public.daily_facts is 'One row per local day. Computed columns are rebuilt by refresh_daily_facts; mood, energy, bedtime, wake_at and highlight are typed by the user (the row is the day they woke up).';

alter table public.daily_facts enable row level security;
revoke all on public.daily_facts from anon, authenticated;
grant select on public.daily_facts to authenticated;
grant update (mood, energy, bedtime, wake_at, highlight) on public.daily_facts to authenticated;
create policy "own facts read" on public.daily_facts for select to authenticated using (user_id = (select auth.uid()));
create policy "own inputs update" on public.daily_facts for update to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));

-- The builder. p_capture_eod = also record the end-of-day task counts (only meaningful right after the day ends).
-- Rows older than 7 days are frozen unless p_force.
create or replace function public.refresh_daily_facts(
  p_user uuid, p_from date, p_to date, p_capture_eod boolean default false, p_force boolean default false)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_tz text;
  v_today date;
  v_n integer := 0;
begin
  select timezone into v_tz from public.user_settings where user_id = p_user;
  v_tz := coalesce(v_tz, 'America/Guayaquil');
  v_today := (now() at time zone v_tz)::date;
  p_to := least(p_to, v_today);
  if p_from is null or p_to is null or p_from > p_to then
    return 0;
  end if;

  with days as (
    select g::date as d from generate_series(p_from, p_to, interval '1 day') g
  ),
  occ as (
    select o.date as d, o.status::text as st, o.block_type_id, coalesce(bt.name, '?') as bname,
      (case when o.end_time < o.start_time then 1440 else 0 end
        + extract(epoch from (o.end_time - o.start_time)) / 60)::int as mins
    from public.block_occurrences o
    left join public.block_types bt on bt.id = o.block_type_id
    where o.user_id = p_user and o.date between p_from and p_to
  ),
  blk as (
    select d,
      count(*) filter (where st in ('scheduled','done','partial')) as planned,
      count(*) filter (where st = 'done') as done,
      count(*) filter (where st = 'partial') as part,
      coalesce(sum(mins) filter (where st in ('scheduled','done','partial')), 0) as mp,
      coalesce(sum(mins) filter (where st = 'done'), 0) as md
    from occ group by d
  ),
  byblk as (
    select d, jsonb_object_agg(block_type_id::text,
      jsonb_build_object('n', bname, 'p', p, 'd', dn, 'mp', mp, 'md', md)) as j
    from (
      select d, block_type_id, max(bname) as bname,
        count(*) filter (where st in ('scheduled','done','partial')) as p,
        count(*) filter (where st = 'done') as dn,
        coalesce(sum(mins) filter (where st in ('scheduled','done','partial')), 0) as mp,
        coalesce(sum(mins) filter (where st = 'done'), 0) as md
      from occ group by d, block_type_id
      having count(*) filter (where st in ('scheduled','done','partial')) > 0
    ) x group by d
  ),
  free as (
    select d.d from days d
    where exists (select 1 from public.free_days f
      where f.user_id = p_user and f.deleted_at is null and d.d between f.from_date and f.to_date)
  ),
  hab as (
    select hc.date as d, count(*) as due,
      count(*) filter (where hc.state::text = 'done') as done,
      count(*) filter (where hc.state::text = 'skipped') as skipped
    from public.habit_checks hc
    where hc.user_id = p_user and hc.date between p_from and p_to
    group by hc.date
  ),
  byhab as (
    select d, jsonb_object_agg(habit_id::text, jsonb_build_object('n', hname, 'due', due, 'done', dn, 'skipped', sk)) as j
    from (
      select hc.date as d, hc.habit_id, coalesce(max(h.name), '?') as hname, count(*) as due,
        count(*) filter (where hc.state::text = 'done') as dn,
        count(*) filter (where hc.state::text = 'skipped') as sk
      from public.habit_checks hc
      left join public.habits h on h.id = hc.habit_id
      where hc.user_id = p_user and hc.date between p_from and p_to
      group by hc.date, hc.habit_id
    ) x group by d
  ),
  tk as (
    select d.d,
      (select count(*) from public.tasks t where t.user_id = p_user and t.deleted_at is null and (t.created_at at time zone v_tz)::date = d.d) as created,
      (select count(*) from public.tasks t where t.user_id = p_user and t.deleted_at is null and (t.completed_at at time zone v_tz)::date = d.d) as completed,
      (select count(*) from public.tasks t where t.user_id = p_user and t.deleted_at is null and (t.archived_at at time zone v_tz)::date = d.d) as archived,
      (select count(*) from public.task_day_log l where l.user_id = p_user and l.date = d.d and l.outcome = 'moved') as moved,
      (select count(*) from public.task_day_log l where l.user_id = p_user and l.date = d.d and l.outcome = 'skipped') as skipped,
      case when p_capture_eod then (select count(*) from public.tasks t where t.user_id = p_user and t.deleted_at is null and t.status::text = 'pending' and t.scheduled_for <= d.d) end as open_eod,
      case when p_capture_eod then (select count(*) from public.tasks t where t.user_id = p_user and t.deleted_at is null and t.status::text = 'pending' and t.scheduled_for <= d.d and t.rolled_over_count >= 3) end as stale_eod
    from days d
  ),
  tx as (
    select (t.occurred_at at time zone v_tz)::date as d, t.type::text as ty, t.amount, coalesce(c.name, 'Uncategorized') as cat
    from public.transactions t
    left join public.categories c on c.id = t.category_id
    where t.user_id = p_user and t.deleted_at is null
      and (t.occurred_at at time zone v_tz)::date between p_from and p_to
  ),
  mny as (
    select d,
      coalesce(sum(amount) filter (where ty = 'expense' and lower(cat) <> 'adjustment'), 0) as spent,
      coalesce(sum(amount) filter (where ty = 'income' and lower(cat) <> 'adjustment'), 0) as earned,
      coalesce(sum(case when ty = 'expense' then amount else -amount end) filter (where lower(cat) = 'adjustment'), 0) as adj,
      count(*) as n
    from tx group by d
  ),
  bycat as (
    select d, jsonb_object_agg(cat, total) as j
    from (select d, cat, sum(amount) as total from tx where ty = 'expense' and lower(cat) <> 'adjustment' group by d, cat) x
    group by d
  ),
  acc as (
    select d.d, a.id, ((d.d + 1)::timestamp at time zone v_tz) as eod
    from days d cross join public.accounts a
    where a.user_id = p_user and a.deleted_at is null
  ),
  bal as (
    select acc.d,
      round(sum(s.amount
        + coalesce((select sum(case when t.type::text = 'income' then t.amount else -t.amount end)
            from public.transactions t
            where t.user_id = p_user and t.account_id = acc.id and t.deleted_at is null
              and t.occurred_at > s.recorded_at and t.occurred_at < acc.eod), 0)
        + coalesce((select sum((case when tr.to_account_id = acc.id then tr.amount else 0 end)
                             - (case when tr.from_account_id = acc.id then tr.amount else 0 end))
            from public.transfers tr
            where tr.user_id = p_user and tr.deleted_at is null
              and tr.occurred_at > s.recorded_at and tr.occurred_at < acc.eod
              and acc.id in (tr.to_account_id, tr.from_account_id)), 0)), 2) as total
    from acc
    left join lateral (
      select b.amount, b.recorded_at from public.balance_snapshots b
      where b.user_id = p_user and b.account_id = acc.id and b.deleted_at is null and b.recorded_at < acc.eod
      order by b.recorded_at desc limit 1) s on true
    group by acc.d
  ),
  wk as (
    select w.class_date as d, count(*) as c, coalesce(sum(w.hours), 0) as h, coalesce(sum(w.amount), 0) as a
    from public.work_classes w
    where w.user_id = p_user and w.status = 'taught' and w.class_date between p_from and p_to
    group by w.class_date
  ),
  nt as (
    select (n.created_at at time zone v_tz)::date as d, count(*) as c,
      count(*) filter (where n.source::text = 'telegram_bot') as bot,
      coalesce(sum(case when btrim(coalesce(n.content, '')) = '' then 0
        else array_length(regexp_split_to_array(btrim(n.content), '\s+'), 1) end), 0) as words
    from public.notes n
    where n.user_id = p_user and n.deleted_at is null and coalesce(n.is_template, false) = false
      and (n.created_at at time zone v_tz)::date between p_from and p_to
    group by 1
  ),
  ai as (
    select (u.at at time zone v_tz)::date as d, count(*) as calls,
      coalesce(sum(coalesce(u.prompt_tokens, 0) + coalesce(u.completion_tokens, 0)), 0) as tok
    from public.ai_usage u
    where u.user_id = p_user and (u.at at time zone v_tz)::date between p_from and p_to
    group by 1
  )
  insert into public.daily_facts as f (
    user_id, date, closed, computed_at, formula_version, is_free_day,
    blocks_planned, blocks_done, blocks_partial, block_min_planned, block_min_done, by_block,
    habits_due, habits_done, habits_skipped, by_habit,
    tasks_created, tasks_completed, tasks_archived, tasks_moved, tasks_skipped, tasks_open_eod, tasks_stale_eod,
    spent, earned, adjustment, tx_count, spent_by_category, balance_total,
    work_classes, work_hours, work_amount,
    notes_created, notes_from_bot, words_new, ai_calls, ai_tokens)
  select p_user, days.d, days.d < v_today, now(), 1, (free.d is not null),
    coalesce(blk.planned, 0), coalesce(blk.done, 0), coalesce(blk.part, 0), coalesce(blk.mp, 0), coalesce(blk.md, 0), coalesce(byblk.j, '{}'::jsonb),
    coalesce(hab.due, 0), coalesce(hab.done, 0), coalesce(hab.skipped, 0), coalesce(byhab.j, '{}'::jsonb),
    tk.created, tk.completed, tk.archived, tk.moved, tk.skipped, tk.open_eod, tk.stale_eod,
    coalesce(mny.spent, 0), coalesce(mny.earned, 0), coalesce(mny.adj, 0), coalesce(mny.n, 0), coalesce(bycat.j, '{}'::jsonb), bal.total,
    coalesce(wk.c, 0), coalesce(wk.h, 0), coalesce(wk.a, 0),
    coalesce(nt.c, 0), coalesce(nt.bot, 0), coalesce(nt.words, 0), coalesce(ai.calls, 0), coalesce(ai.tok, 0)
  from days
  left join free on free.d = days.d
  left join blk on blk.d = days.d
  left join byblk on byblk.d = days.d
  left join hab on hab.d = days.d
  left join byhab on byhab.d = days.d
  left join tk on tk.d = days.d
  left join mny on mny.d = days.d
  left join bycat on bycat.d = days.d
  left join bal on bal.d = days.d
  left join wk on wk.d = days.d
  left join nt on nt.d = days.d
  left join ai on ai.d = days.d
  on conflict (user_id, date) do update set
    closed = excluded.closed, computed_at = excluded.computed_at, formula_version = excluded.formula_version,
    is_free_day = excluded.is_free_day,
    blocks_planned = excluded.blocks_planned, blocks_done = excluded.blocks_done, blocks_partial = excluded.blocks_partial,
    block_min_planned = excluded.block_min_planned, block_min_done = excluded.block_min_done, by_block = excluded.by_block,
    habits_due = excluded.habits_due, habits_done = excluded.habits_done, habits_skipped = excluded.habits_skipped, by_habit = excluded.by_habit,
    tasks_created = excluded.tasks_created, tasks_completed = excluded.tasks_completed, tasks_archived = excluded.tasks_archived,
    tasks_moved = excluded.tasks_moved, tasks_skipped = excluded.tasks_skipped,
    tasks_open_eod = case when p_capture_eod then excluded.tasks_open_eod else f.tasks_open_eod end,
    tasks_stale_eod = case when p_capture_eod then excluded.tasks_stale_eod else f.tasks_stale_eod end,
    spent = excluded.spent, earned = excluded.earned, adjustment = excluded.adjustment, tx_count = excluded.tx_count,
    spent_by_category = excluded.spent_by_category, balance_total = excluded.balance_total,
    work_classes = excluded.work_classes, work_hours = excluded.work_hours, work_amount = excluded.work_amount,
    notes_created = excluded.notes_created, notes_from_bot = excluded.notes_from_bot, words_new = excluded.words_new,
    ai_calls = excluded.ai_calls, ai_tokens = excluded.ai_tokens
  where p_force or f.date >= v_today - 7;

  get diagnostics v_n = row_count;
  return v_n;
end $$;

-- Nightly: at about 02:30 local, close yesterday (with end-of-day task counts) and recompute the last 7 days.
create or replace function public.refresh_daily_facts_nightly()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  r record;
  v_today date;
  v_n integer := 0;
begin
  for r in select user_id, coalesce(timezone, 'America/Guayaquil') as tz from public.user_settings loop
    if extract(hour from (now() at time zone r.tz)) <> 2 then
      continue;
    end if;
    v_today := (now() at time zone r.tz)::date;
    v_n := v_n + public.refresh_daily_facts(r.user_id, v_today - 1, v_today - 1, true, false);
    v_n := v_n + public.refresh_daily_facts(r.user_id, v_today - 7, v_today, false, false);
  end loop;
  return v_n;
end $$;

-- From the app (signed-in user): rebuild the given days, default today. At most 400 days.
create or replace function public.refresh_my_daily_facts(p_from date default null, p_to date default null)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_tz text;
  v_today date;
begin
  if auth.uid() is null then
    return 0;
  end if;
  select timezone into v_tz from public.user_settings where user_id = auth.uid();
  v_today := (now() at time zone coalesce(v_tz, 'America/Guayaquil'))::date;
  p_to := coalesce(p_to, v_today);
  p_from := greatest(coalesce(p_from, p_to), p_to - 400);
  return public.refresh_daily_facts(auth.uid(), p_from, p_to, false, false);
end $$;

revoke execute on function public.refresh_daily_facts(uuid, date, date, boolean, boolean) from public, anon, authenticated;
revoke execute on function public.refresh_daily_facts_nightly() from public, anon, authenticated;
revoke execute on function public.refresh_my_daily_facts(date, date) from public, anon;
grant execute on function public.refresh_my_daily_facts(date, date) to authenticated;

-- Views behind the dashboard. security_invoker so your row-level security still applies.
create or replace view public.daily_scores with (security_invoker = true) as
select user_id, date, block_rate, habit_rate, task_rate, unlogged,
  case when unlogged then null else round(100 * (coalesce(0.5 * block_rate, 0) + coalesce(0.3 * habit_rate, 0) + coalesce(0.2 * task_rate, 0))
    / nullif((case when block_rate is not null then 0.5 else 0 end)
           + (case when habit_rate is not null then 0.3 else 0 end)
           + (case when task_rate  is not null then 0.2 else 0 end), 0)) end as score
from (
  select user_id, date,
    (blocks_done + 0.5 * blocks_partial)::numeric / nullif(blocks_planned, 0) as block_rate,
    habits_done::numeric / nullif(habits_due - habits_skipped, 0) as habit_rate,
    tasks_completed::numeric / nullif(tasks_completed + tasks_moved + tasks_skipped, 0) as task_rate,
    (blocks_done + blocks_partial + habits_done + tasks_completed = 0) as unlogged
  from public.daily_facts
) r;

create or replace view public.weekly_summary with (security_invoker = true) as
select f.user_id, date_trunc('week', f.date)::date as week,
  round(avg(s.score)) as score,
  count(*) filter (where not s.unlogged) as logged_days,
  sum(f.blocks_done) as blocks_done, sum(f.tasks_completed) as tasks_done,
  sum(f.spent) as spent, sum(f.earned) as earned, sum(f.work_hours) as work_hours,
  round(sum(f.spent) / nullif(max(w.substitute_rate), 0), 1) as hours_of_life,
  sum(f.notes_created) as notes, round(avg(f.mood), 1) as mood,
  lag(round(avg(s.score))) over (partition by f.user_id order by date_trunc('week', f.date)) as prev_score
from public.daily_facts f
join public.daily_scores s using (user_id, date)
left join public.work_settings w using (user_id)
group by f.user_id, date_trunc('week', f.date);

create or replace view public.money_runway with (security_invoker = true) as
with last_bal as (
  select distinct on (user_id) user_id, date, balance_total
  from public.daily_facts where balance_total is not null order by user_id, date desc),
burn as (
  select user_id, sum(spent) / 14 as per_day
  from public.daily_facts where date > current_date - 14
  group by user_id having count(*) filter (where tx_count > 0) >= 5)
select l.user_id, l.balance_total, round(b.per_day, 2) as burn_per_day,
  floor(l.balance_total / nullif(b.per_day, 0)) as days_left
from last_bal l join burn b using (user_id);

revoke all on public.daily_scores, public.weekly_summary, public.money_runway from anon, authenticated;
grant select on public.daily_scores, public.weekly_summary, public.money_runway to authenticated;

-- One-time backfill (already run): select public.refresh_daily_facts(user_id, date '2026-10-23', current_date, false, true) from public.user_settings;
-- Nightly job inside the database, same style as the existing rollover and insights jobs (checks every hour, acts at 02:xx local).
select cron.schedule('daily-facts-nightly', '30 * * * *', $cron$select public.refresh_daily_facts_nightly()$cron$);
