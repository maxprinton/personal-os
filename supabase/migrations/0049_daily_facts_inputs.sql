-- Personal OS - daily_facts inputs (migration 0049)
-- WHAT IT DOES, in plain words:
--   1. Mood and Energy are the metrics you already have (Habits > Metrics, "mood 7" in Telegram). Every time one of them
--      is logged, from any place, the day's row in daily_facts gets that value. One value, many ways to enter it.
--   2. Creates an "Energy" metric (1-10) next to Mood, so you can log it the same ways.
-- It does NOT change or delete any existing data. Safe to run twice.
-- HOW TO RUN: Supabase > SQL Editor > New query > paste this whole file > Run.
-- If Supabase warns about "destructive" statements, it is because of "drop trigger if exists" (it only replaces
-- this migration's own trigger); it is safe to confirm.

-- Copies Mood / Energy of the metrics into daily_facts for the given days (keeps the old value if no metric value exists).
create or replace function public.sync_day_metrics(p_user uuid, p_from date, p_to date)
returns void
language sql
security definer
set search_path = public
as $$
  update public.daily_facts f set
    mood = coalesce((
      select case when m.value between 1 and 10 then round(m.value)::smallint end
      from public.daily_metrics m join public.metric_definitions d on d.id = m.metric_id
      where m.user_id = f.user_id and m.log_date = f.date and m.deleted_at is null and d.deleted_at is null and lower(d.name) = 'mood'
      limit 1), f.mood),
    energy = coalesce((
      select case when m.value between 1 and 10 then round(m.value)::smallint end
      from public.daily_metrics m join public.metric_definitions d on d.id = m.metric_id
      where m.user_id = f.user_id and m.log_date = f.date and m.deleted_at is null and d.deleted_at is null and lower(d.name) = 'energy'
      limit 1), f.energy)
  where f.user_id = p_user and f.date between p_from and p_to;
$$;

-- Every time a Mood or Energy value is logged (any channel), the day's row is refreshed. Never blocks the metric itself.
create or replace function public.trg_metric_to_facts()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_name text;
  v_user uuid := coalesce(new.user_id, old.user_id);
  v_date date := coalesce(new.log_date, old.log_date);
begin
  begin
    select lower(name) into v_name from public.metric_definitions where id = coalesce(new.metric_id, old.metric_id);
    if v_name in ('mood', 'energy') then
      perform public.refresh_daily_facts(v_user, v_date, v_date, false, true);
      insert into public.daily_facts (user_id, date) values (v_user, v_date) on conflict do nothing;
      perform public.sync_day_metrics(v_user, v_date, v_date);
    end if;
  exception when others then
    null;
  end;
  return null;
end $$;

drop trigger if exists daily_metrics_to_facts on public.daily_metrics;
create trigger daily_metrics_to_facts after insert or update on public.daily_metrics
  for each row execute function public.trg_metric_to_facts();

revoke execute on function public.sync_day_metrics(uuid, date, date) from public, anon, authenticated;
revoke execute on function public.trg_metric_to_facts() from public, anon, authenticated;

-- Energy (1-10) next to Mood, so it can be logged the same ways. Safe to run twice.
insert into public.metric_definitions (user_id, name, unit, min_value, max_value)
select us.user_id, 'Energy', '1-10', 1, 10 from public.user_settings us
where not exists (
  select 1 from public.metric_definitions d where d.user_id = us.user_id and lower(d.name) = 'energy' and d.deleted_at is null);
