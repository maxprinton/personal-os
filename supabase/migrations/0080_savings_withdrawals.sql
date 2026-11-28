-- Personal OS - 0080: taking money out of savings (BL-124 follow-up, decided 28 Nov 2026).
--   A transfer OUT of the savings account (budget_settings.savings_account_id) is asked on Finance:
--     used     = the money was spent; Savings goes down and the money is back in Spending money.
--     borrowed = Savings stays; what is "to move" grows until the money is put back.
--   No row yet = not answered: counts as used.
-- Additive and safe to run twice.

create table if not exists public.budget_savings_withdrawals (
  transfer_id uuid primary key references public.transfers(id) on delete cascade,
  user_id     uuid not null default auth.uid() references auth.users(id) on delete cascade,
  kind        text not null check (kind in ('used', 'borrowed')),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index if not exists budget_savings_withdrawals_user_idx on public.budget_savings_withdrawals (user_id);

drop trigger if exists budget_savings_withdrawals_updated_at on public.budget_savings_withdrawals;
create trigger budget_savings_withdrawals_updated_at before update on public.budget_savings_withdrawals
  for each row execute function public.set_updated_at();

alter table public.budget_savings_withdrawals enable row level security;
drop policy if exists "own rows" on public.budget_savings_withdrawals;
create policy "own rows" on public.budget_savings_withdrawals for all to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));

-- Test probe for the mission (same pattern as 0079)
create or replace function public.tprobe_savings_withdrawal_marked(p_user uuid, p_since timestamptz) returns boolean
  language sql stable set search_path to 'public'
  as $$ select exists (select 1 from budget_savings_withdrawals where user_id = p_user and updated_at > p_since) $$;

select 'budget_savings_withdrawals' as checked, count(*)::text as found
from information_schema.tables where table_schema = 'public' and table_name = 'budget_savings_withdrawals';
