-- Personal OS - 0066: Telegram no longer pushes Backlog messages unless the user turns it on (BL-97).
-- The did-it-work question, the Monday summary, the "waiting on you" steps and the test-mission messages are all gated by this one switch.
-- Capturing ideas with idea:/bug: and the /backlog and /ideas views are not affected. Safe to run twice.
alter table public.backlog_settings add column if not exists telegram_push boolean not null default false;
