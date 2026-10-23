-- Personal OS - Phases 6 & 7: Telegram linking + weekly "Chief of Staff" insights

-- ---------- Telegram linking ----------------------------------------
alter table public.user_settings
  add column if not exists telegram_link_code text unique,
  add column if not exists telegram_link_expires timestamptz;

-- ---------- Insights --------------------------------------------------
-- Writes a weekly summary plus warnings/patterns for each user.
-- p_force = true replaces today's insights (used by the "Generate now" button).
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

    -- Summary of the last 7 days
    select count(*) into v_tasks_done from public.tasks
     where user_id = u.user_id and deleted_at is null and status = 'completed'
       and completed_at >= now() - interval '7 days';
    select count(*) into v_habits_done from public.activity_logs
     where user_id = u.user_id and deleted_at is null and status = 'completed'
       and log_date > v_today - 7;
    select coalesce(sum(amount), 0) into v_spent from public.transactions
     where user_id = u.user_id and deleted_at is null and type = 'expense'
       and occurred_at >= now() - interval '7 days';
    insert into public.system_insights (user_id, insight_type, message)
    values (u.user_id, 'summary',
      format('Last 7 days: %s tasks done, %s habit check-ins, $%s spent.',
             v_tasks_done, v_habits_done, to_char(v_spent, 'FM999,999,990.00')));
    n := n + 1;

    -- Warning: tasks postponed 3+ times
    select count(*), string_agg(title, ', ' order by rolled_over_count desc)
      into v_count, v_titles
      from (select title, rolled_over_count from public.tasks
             where user_id = u.user_id and deleted_at is null and status = 'pending'
               and rolled_over_count >= 3
             order by rolled_over_count desc limit 3) t;
    if v_count > 0 then
      insert into public.system_insights (user_id, insight_type, message)
      values (u.user_id, 'warning',
        format('You keep postponing: %s. Break them down, schedule them in a block, or drop them.', v_titles));
      n := n + 1;
    end if;

    -- Pattern: stagnant backlog (untouched for 14+ days)
    select count(*) into v_count from public.tasks
     where user_id = u.user_id and deleted_at is null and status = 'backlog'
       and updated_at < now() - interval '14 days';
    if v_count >= 3 then
      insert into public.system_insights (user_id, insight_type, message)
      values (u.user_id, 'pattern',
        format('%s backlog tasks have not moved in 2+ weeks. A 10-minute review could clear them.', v_count));
      n := n + 1;
    end if;

    -- Warning: habit blocks below 50%% in the last 7 days
    for r in
      select b.title,
             (select count(*) from public.activity_logs a
               where a.entity_type = 'time_block' and a.entity_id = b.id and a.deleted_at is null
                 and a.status = 'completed' and a.log_date > v_today - 7) as done,
             case when b.rrule ilike 'FREQ=DAILY%' then 7
                  else coalesce(array_length(string_to_array(split_part(upper(b.rrule), 'BYDAY=', 2), ','), 1), 0)
             end as due
        from public.time_blocks b
       where b.user_id = u.user_id and b.deleted_at is null and b.is_habit
         and b.valid_from <= v_today - 7
    loop
      if r.due > 0 and r.done * 2 < r.due then
        insert into public.system_insights (user_id, insight_type, message)
        values (u.user_id, 'warning',
          format('"%s" was done %s of %s times this week. Is the time slot still right?', r.title, r.done, r.due));
        n := n + 1;
      end if;
    end loop;

    -- Warning: monthly budgets already over the limit
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

create or replace function public.generate_my_insights()
returns integer
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then
    return 0;
  end if;
  return public.generate_insights(auth.uid(), true);
end $$;

revoke execute on function public.generate_my_insights() from public, anon;
grant execute on function public.generate_my_insights() to authenticated;

select cron.schedule('weekly-insights', '0 13 * * 1', 'select public.generate_insights()');
