-- Probes must not be erased by the mission's own cleanup step (delete / stop the test data).
-- Already applied to the project on 15 Nov 2026 through the connector; safe to run twice.
create or replace function public.tprobe_recurring_done(p_user uuid, p_since timestamptz)
returns boolean language sql stable set search_path to 'public' as $$
  select exists (
    select 1 from task_series
    where user_id = p_user
      and last_done_task_id is not null
      and last_done_on >= (p_since::date - 1)
  )
$$;

create or replace function public.tprobe_idea_added(p_user uuid, p_since timestamptz)
returns boolean language sql stable set search_path to 'public' as $$
  select exists (select 1 from backlog_items where user_id = p_user and source in ('web','telegram') and created_at > p_since)
$$;

create or replace function public.tprobe_idea_telegram(p_user uuid, p_since timestamptz)
returns boolean language sql stable set search_path to 'public' as $$
  select exists (select 1 from backlog_items where user_id = p_user and source = 'telegram' and created_at > p_since)
$$;
