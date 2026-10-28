-- 0019 · Telegram bot v2 (28 Oct 2026)
--   bot_threads                    which bot message a reply belongs to (reply to "Saved ✓" to correct it,
--                                  answers to the bot's questions: new name, another date, amount paid)
--   transactions.receipt_file_id   the receipt photo (kept by Telegram; 🧾 in /movements sends it back)
--   user_settings.reminder_block_end  "When a block ends" message (ON by default)
-- Safe to run twice. Nothing else changes.

create table if not exists public.bot_threads (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users(id) on delete cascade,
  chat_id     bigint not null,
  message_id  bigint not null,
  kind        text not null,
  payload     jsonb not null default '{}'::jsonb,
  created_at  timestamptz not null default now()
);
create unique index if not exists bot_threads_msg_uq on public.bot_threads (chat_id, message_id);
create index if not exists bot_threads_user_idx on public.bot_threads (user_id, created_at desc);
alter table public.bot_threads enable row level security;
drop policy if exists "own rows" on public.bot_threads;
create policy "own rows" on public.bot_threads for all to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));

alter table public.transactions add column if not exists receipt_file_id text;

alter table public.user_settings add column if not exists reminder_block_end boolean not null default true;

-- Check: should list the 3 changes
select 'bot_threads' as what, count(*)::text as value from public.bot_threads
union all
select 'transactions.receipt_file_id', count(*)::text from information_schema.columns
  where table_schema = 'public' and table_name = 'transactions' and column_name = 'receipt_file_id'
union all
select 'user_settings.reminder_block_end', count(*)::text from information_schema.columns
  where table_schema = 'public' and table_name = 'user_settings' and column_name = 'reminder_block_end';
