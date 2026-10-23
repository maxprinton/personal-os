-- Personal OS - Phase 3: nightly task rollover
-- Applies each pending task's rollover_policy once its scheduled day has passed
-- in the owner's timezone. Safe to run any number of times (idempotent).

create or replace function public.process_task_rollover(p_user uuid default null)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  total integer := 0;
  c integer;
begin
  -- migrate: move to the user's local today
  update public.tasks t
     set scheduled_for = (now() at time zone s.timezone)::date,
         rolled_over_count = t.rolled_over_count + 1
    from public.user_settings s
   where s.user_id = t.user_id
     and (p_user is null or t.user_id = p_user)
     and t.deleted_at is null
     and t.status = 'pending'
     and t.rollover_policy = 'migrate'
     and t.scheduled_for < (now() at time zone s.timezone)::date;
  get diagnostics c = row_count; total := total + c;

  -- backlog: hide it in the backlog
  update public.tasks t
     set status = 'backlog',
         rolled_over_count = t.rolled_over_count + 1
    from public.user_settings s
   where s.user_id = t.user_id
     and (p_user is null or t.user_id = p_user)
     and t.deleted_at is null
     and t.status = 'pending'
     and t.rollover_policy = 'backlog'
     and t.scheduled_for < (now() at time zone s.timezone)::date;
  get diagnostics c = row_count; total := total + c;

  -- graveyard: mark as failed
  update public.tasks t
     set status = 'failed'
    from public.user_settings s
   where s.user_id = t.user_id
     and (p_user is null or t.user_id = p_user)
     and t.deleted_at is null
     and t.status = 'pending'
     and t.rollover_policy = 'graveyard'
     and t.scheduled_for < (now() at time zone s.timezone)::date;
  get diagnostics c = row_count; total := total + c;

  return total;
end $$;

-- Only the scheduler (postgres) may run it for everyone
revoke execute on function public.process_task_rollover(uuid) from public, anon, authenticated;

-- The app can trigger it for the signed-in user only (runs on page load as a safety net)
create or replace function public.rollover_my_tasks()
returns integer
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then
    return 0;
  end if;
  return public.process_task_rollover(auth.uid());
end $$;

revoke execute on function public.rollover_my_tasks() from public, anon;
grant execute on function public.rollover_my_tasks() to authenticated;

create extension if not exists pg_cron;
select cron.schedule('task-rollover', '5 * * * *', 'select public.process_task_rollover()');
