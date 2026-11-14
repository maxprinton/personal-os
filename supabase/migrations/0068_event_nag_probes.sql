-- Personal OS - 0068: test probes for the event nags missions (BL-98). Safe to run twice.
create or replace function public.tprobe_event_nag_added(p_user uuid, p_since timestamptz) returns boolean
  language sql stable set search_path to 'public'
  as $$ select exists (select 1 from event_nags where user_id = p_user and created_at > p_since) $$;

create or replace function public.tprobe_event_nag_sent(p_user uuid, p_since timestamptz) returns boolean
  language sql stable set search_path to 'public'
  as $$ select exists (select 1 from reminder_log where user_id = p_user and kind = 'nag' and sent_at > p_since) $$;
