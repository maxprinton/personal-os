-- Personal OS - 0076: category budgets you can edit, with optional rollover and a month-by-month history.
-- Decisions (27 Nov 2026):
--   * Rollover is a per-budget switch, off by default, shown right on the budget in Finance.
--   * Both directions carry: unused money adds to the next period, overspending takes from it.
--   * What is available in a period is capped at double that period's limit; it can go below zero.
--   * Counting starts in the period the switch is turned on (rollover_since); turning it off forgets the carry.
--   * budget_limit_changes keeps the limit each period had, so the history and the carry use the right limit.
--     A change made during a period applies to that whole period (as editing always did).
-- Additive and safe to run twice.

alter table public.budgets add column if not exists rollover boolean not null default false;
alter table public.budgets add column if not exists rollover_since date;
-- First period of the budget's history: when it was created, or when its period (weekly/monthly) last changed.
alter table public.budgets add column if not exists started_on date;

create table if not exists public.budget_limit_changes (
  id             uuid primary key default gen_random_uuid(),
  user_id        uuid not null default auth.uid() references auth.users(id) on delete cascade,
  budget_id      uuid not null references public.budgets(id) on delete cascade,
  limit_amount   numeric(12,2) not null check (limit_amount > 0),
  effective_from date not null,
  created_at     timestamptz not null default now()
);
create unique index if not exists budget_limit_changes_uq on public.budget_limit_changes (budget_id, effective_from);
create index if not exists budget_limit_changes_user_idx on public.budget_limit_changes (user_id);

alter table public.budget_limit_changes enable row level security;
drop policy if exists "own rows" on public.budget_limit_changes;
create policy "own rows" on public.budget_limit_changes for all to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));

-- Existing budgets: their history starts in the period they were created (user's local time),
-- with the limit they have today (no earlier limits were ever recorded).
update public.budgets b
set started_on = case b.period
    when 'weekly' then date_trunc('week', b.created_at at time zone coalesce(s.timezone, 'America/Guayaquil'))::date
    else date_trunc('month', b.created_at at time zone coalesce(s.timezone, 'America/Guayaquil'))::date
  end
from (select bb.id, us.timezone from public.budgets bb left join public.user_settings us on us.user_id = bb.user_id) s
where s.id = b.id and b.started_on is null;

insert into public.budget_limit_changes (user_id, budget_id, limit_amount, effective_from)
select b.user_id, b.id, b.limit_amount, b.started_on
from public.budgets b
where b.started_on is not null
  and not exists (select 1 from public.budget_limit_changes c where c.budget_id = b.id);

select 'budgets.rollover' as checked, count(*)::text as found
from information_schema.columns where table_schema = 'public' and table_name = 'budgets' and column_name in ('rollover', 'rollover_since', 'started_on')
union all
select 'budget_limit_changes rows', count(*)::text from public.budget_limit_changes;
