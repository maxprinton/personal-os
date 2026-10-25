-- Personal OS - transfers between accounts.
-- A transfer moves money from one account to another. It is NOT income or expense, so it never
-- counts in monthly totals or budgets; it only changes the two account balances.
-- Safe to run twice.

create table if not exists public.transfers (
  id               uuid primary key default gen_random_uuid(),
  user_id          uuid not null default auth.uid() references auth.users(id) on delete cascade,
  from_account_id  uuid not null references public.accounts(id) on delete cascade,
  to_account_id    uuid not null references public.accounts(id) on delete cascade,
  amount           numeric(12,2) not null check (amount > 0),
  note             text,
  occurred_at      timestamptz not null default now(),
  source           capture_source not null default 'web',
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  deleted_at       timestamptz,
  check (from_account_id <> to_account_id)
);
create index if not exists transfers_user_date_idx on public.transfers (user_id, occurred_at desc);

drop trigger if exists transfers_updated_at on public.transfers;
create trigger transfers_updated_at before update on public.transfers
  for each row execute function public.set_updated_at();
alter table public.transfers enable row level security;
drop policy if exists "own rows" on public.transfers;
create policy "own rows" on public.transfers for all to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
