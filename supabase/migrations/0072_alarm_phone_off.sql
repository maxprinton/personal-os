-- BL-110: the phone reports when it was switched off ("off": alarm_at = when it went off, at = when it came back on),
-- so the alarms day view can say "Phone was off" instead of "Didn't ring". Safe to run twice.
alter table public.alarm_events drop constraint if exists alarm_events_kind_check;
alter table public.alarm_events add constraint alarm_events_kind_check
  check (kind in ('rang', 'answer', 'checkin', 'tick', 'sleep', 'off'));
