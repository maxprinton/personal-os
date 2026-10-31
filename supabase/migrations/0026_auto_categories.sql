-- Personal OS - 0026: automatic categories (AI)
--  · transactions.auto_category  'ai' or 'history' when the app (not you) chose the category; null once you edit
--    or confirm it. Shows the ✨ mark and lets you review or undo.
--  · category_proposals          new categories the AI proposes; nothing is created until you approve
--    (on the web or in Telegram). Approved → the category is created and applied to its transactions.
-- Safe to run twice.

alter table public.transactions add column if not exists auto_category text;
alter table public.transactions drop constraint if exists transactions_auto_category_check;
alter table public.transactions add constraint transactions_auto_category_check check (auto_category in ('history', 'ai'));
create index if not exists transactions_auto_idx on public.transactions (user_id) where auto_category is not null;

create table if not exists public.category_proposals (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null default auth.uid() references auth.users(id) on delete cascade,
  name         text not null,
  kind         transaction_type not null,
  tx_ids       uuid[] not null default '{}',
  status       text not null default 'pending' check (status in ('pending', 'approved', 'rejected', 'expired')),
  category_id  uuid references public.categories(id) on delete set null,
  created_at   timestamptz not null default now(),
  resolved_at  timestamptz
);
create index if not exists category_proposals_user_idx on public.category_proposals (user_id, status);
alter table public.category_proposals enable row level security;
drop policy if exists "own rows" on public.category_proposals;
create policy "own rows" on public.category_proposals for all to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
