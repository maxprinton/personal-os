-- Personal OS - 0078: envelopes can "just watch" (decided 27 Nov 2026).
--   set_aside (default): the envelope's money is held from Spending money; spending in its categories comes out of it.
--   watch: no money is held. Its payments count where they normally would (recurring payments in Fixed costs,
--          the rest as spending, subtracted when paid); the envelope only tracks them against its limit and warns
--          at 80 % and 100 %. A watching envelope needs at least one category.
-- Additive and safe to run twice.
alter table public.budgets add column if not exists mode text not null default 'set_aside';
alter table public.budgets drop constraint if exists budgets_mode_check;
alter table public.budgets add constraint budgets_mode_check check (mode in ('set_aside', 'watch'));

select 'budgets.mode' as checked, count(*)::text as found
from information_schema.columns where table_schema = 'public' and table_name = 'budgets' and column_name = 'mode';
