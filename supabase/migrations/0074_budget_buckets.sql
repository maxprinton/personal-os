-- 0074 Budget with buckets for freelance income (BL-117). Safe to run twice.
-- Savings, Fixed costs and Spending money are CALCULATED from transactions, so nothing here stores a balance:
-- only the settings, the per-payment "skip saving" marks and the custom buckets.

create table if not exists public.budget_settings (
  user_id uuid primary key default auth.uid() references auth.users(id) on delete cascade,
  start_date date not null,
  savings_percent numeric(5,2) not null default 10 check (savings_percent >= 0 and savings_percent <= 100),
  counted_category_ids uuid[] not null default '{}',
  opening_spending numeric(12,2) not null default 0,
  opening_savings numeric(12,2) not null default 0,
  savings_name text not null default 'Savings' check (length(btrim(savings_name)) > 0),
  fixed_name text not null default 'Fixed costs' check (length(btrim(fixed_name)) > 0),
  spending_name text not null default 'Spending money' check (length(btrim(spending_name)) > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.budget_buckets (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  name text not null check (length(btrim(name)) > 0),
  monthly_amount numeric(12,2) not null default 0 check (monthly_amount >= 0),
  position integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);
create index if not exists budget_buckets_user_idx on public.budget_buckets (user_id, position) where deleted_at is null;

create table if not exists public.budget_saving_skips (
  transaction_id uuid primary key references public.transactions(id) on delete cascade,
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  created_at timestamptz not null default now()
);
create index if not exists budget_saving_skips_user_idx on public.budget_saving_skips (user_id);

drop trigger if exists budget_settings_updated_at on public.budget_settings;
create trigger budget_settings_updated_at before update on public.budget_settings
  for each row execute function public.set_updated_at();
drop trigger if exists budget_buckets_updated_at on public.budget_buckets;
create trigger budget_buckets_updated_at before update on public.budget_buckets
  for each row execute function public.set_updated_at();

alter table public.budget_settings enable row level security;
alter table public.budget_buckets enable row level security;
alter table public.budget_saving_skips enable row level security;
drop policy if exists "own rows" on public.budget_settings;
create policy "own rows" on public.budget_settings for all to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
drop policy if exists "own rows" on public.budget_buckets;
create policy "own rows" on public.budget_buckets for all to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
drop policy if exists "own rows" on public.budget_saving_skips;
create policy "own rows" on public.budget_saving_skips for all to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));

-- Decision 13: Salary is renamed Gigs (old transactions keep their category under the new name).
-- Skipped when the user already has a Gigs income category.
update public.categories c set name = 'Gigs'
 where c.kind = 'income' and c.deleted_at is null and c.name = 'Salary'
   and not exists (select 1 from public.categories g where g.user_id = c.user_id and g.kind = 'income' and g.deleted_at is null and lower(g.name) = 'gigs');

-- Decision 12: a Pets category so pet payments count as fixed costs.
insert into public.categories (user_id, name, kind)
select u.user_id, 'Pets', 'expense' from (select distinct user_id from public.categories where deleted_at is null) u
 where not exists (select 1 from public.categories p where p.user_id = u.user_id and p.kind = 'expense' and p.deleted_at is null and lower(p.name) = 'pets');

-- Test probes for the BL-117 mission (same pattern as 0068/0069/0071/0073).
create or replace function public.tprobe_budget_setup(p_user uuid, p_since timestamptz) returns boolean
  language sql stable set search_path to 'public'
  as $$ select exists (select 1 from budget_settings where user_id = p_user and updated_at > p_since) $$;

create or replace function public.tprobe_budget_skip(p_user uuid, p_since timestamptz) returns boolean
  language sql stable set search_path to 'public'
  as $$ select exists (select 1 from budget_saving_skips where user_id = p_user and created_at > p_since) $$;
