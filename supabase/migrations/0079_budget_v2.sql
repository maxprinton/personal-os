-- Personal OS - 0079: Budget v2 (BL-124), decided 27 Nov 2026.
--   * Settings: the savings account (Pichincha Ahorro), the plan for a low month ($320) and the cushion target ($250).
--     counted_category_ids now means "work pay": the income that gets the savings and envelope percentages.
--     Every other income still counts as money (it goes straight to Spending money).
--   * Envelopes: a percentage of each month's work pay instead of a fixed amount (Fun 12%),
--     and an optional goal (target amount + date) that also caps the envelope (Licence + cédula $220 by 31 May 2027).
--   * Debts you owe (who, how much) and transactions.debt_id for the payments back.
--   * budget_corrections: the "Fix" button of the real-money check (budget-only, the accounts are already right).
--   * A "Debt payback" expense category.
-- Additive and safe to run twice.

alter table public.budget_settings add column if not exists savings_account_id uuid references public.accounts(id) on delete set null;
alter table public.budget_settings add column if not exists plan_income numeric(12,2) not null default 0;
alter table public.budget_settings add column if not exists cushion_target numeric(12,2) not null default 0;
alter table public.budget_settings drop constraint if exists budget_settings_plan_check;
alter table public.budget_settings add constraint budget_settings_plan_check check (plan_income >= 0 and cushion_target >= 0);

alter table public.budgets add column if not exists percent numeric(5,2);
alter table public.budgets add column if not exists target_amount numeric(12,2);
alter table public.budgets add column if not exists target_date date;
alter table public.budgets drop constraint if exists budgets_percent_check;
alter table public.budgets add constraint budgets_percent_check check (percent is null or (percent > 0 and percent <= 100));
alter table public.budgets drop constraint if exists budgets_target_check;
alter table public.budgets add constraint budgets_target_check check (target_amount is null or target_amount > 0);

create table if not exists public.debts (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null default auth.uid() references auth.users(id) on delete cascade,
  person      text not null check (length(btrim(person)) between 1 and 80),
  amount      numeric(12,2) not null check (amount > 0),
  note        text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  deleted_at  timestamptz
);
create index if not exists debts_user_idx on public.debts (user_id) where deleted_at is null;
drop trigger if exists debts_updated_at on public.debts;
create trigger debts_updated_at before update on public.debts
  for each row execute function public.set_updated_at();
alter table public.debts enable row level security;
drop policy if exists "own rows" on public.debts;
create policy "own rows" on public.debts for all to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));

alter table public.transactions add column if not exists debt_id uuid references public.debts(id) on delete set null;
create index if not exists transactions_debt_idx on public.transactions (debt_id) where debt_id is not null;

create table if not exists public.budget_corrections (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null default auth.uid() references auth.users(id) on delete cascade,
  amount      numeric(12,2) not null check (amount <> 0),
  target      text not null default 'spending' check (target in ('spending', 'savings')),
  note        text,
  created_at  timestamptz not null default now(),
  deleted_at  timestamptz
);
create index if not exists budget_corrections_user_idx on public.budget_corrections (user_id) where deleted_at is null;
alter table public.budget_corrections enable row level security;
drop policy if exists "own rows" on public.budget_corrections;
create policy "own rows" on public.budget_corrections for all to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));

-- A "Debt payback" expense category for every user who has categories
insert into public.categories (user_id, name, kind)
select u.user_id, 'Debt payback', 'expense' from (select distinct user_id from public.categories where deleted_at is null) u
 where not exists (select 1 from public.categories p where p.user_id = u.user_id and p.kind = 'expense' and p.deleted_at is null and lower(p.name) = 'debt payback');

-- Test probes for the BL-124 missions (same pattern as 0068/0069/0071/0073/0074).
create or replace function public.tprobe_debt_added(p_user uuid, p_since timestamptz) returns boolean
  language sql stable set search_path to 'public'
  as $$ select exists (select 1 from debts where user_id = p_user and created_at > p_since) $$;

create or replace function public.tprobe_debt_paid(p_user uuid, p_since timestamptz) returns boolean
  language sql stable set search_path to 'public'
  as $$ select exists (select 1 from transactions where user_id = p_user and debt_id is not null and deleted_at is null and created_at > p_since) $$;

create or replace function public.tprobe_budget_fix(p_user uuid, p_since timestamptz) returns boolean
  language sql stable set search_path to 'public'
  as $$ select exists (select 1 from budget_corrections where user_id = p_user and created_at > p_since) $$;

create or replace function public.tprobe_savings_moved(p_user uuid, p_since timestamptz) returns boolean
  language sql stable set search_path to 'public'
  as $$ select exists (select 1 from transfers t join budget_settings s on s.user_id = t.user_id
                       where t.user_id = p_user and t.to_account_id = s.savings_account_id and t.deleted_at is null and t.created_at > p_since) $$;

select 'budget_settings v2 columns' as checked, count(*)::text as found
from information_schema.columns where table_schema = 'public' and table_name = 'budget_settings' and column_name in ('savings_account_id', 'plan_income', 'cushion_target')
union all
select 'budgets v2 columns', count(*)::text from information_schema.columns where table_schema = 'public' and table_name = 'budgets' and column_name in ('percent', 'target_amount', 'target_date')
union all
select 'debts table', count(*)::text from information_schema.tables where table_schema = 'public' and table_name in ('debts', 'budget_corrections');
