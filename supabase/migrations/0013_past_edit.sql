-- Personal OS - Calendar v2, phase 8: the past is locked by default.
-- Confirming once opens a 1-hour window (past_edit_until) in which past days can be edited
-- without more questions. Changes to a past day affect only that day. Safe to run twice.

alter table public.user_settings add column if not exists past_edit_until timestamptz;
