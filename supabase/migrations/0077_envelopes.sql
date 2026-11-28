-- Personal OS - 0077: category budgets and the budget's extra buckets become ONE thing: envelopes.
-- Decisions (27 Nov 2026):
--   * An envelope has a name, a monthly amount and one or more categories (a category is in one envelope at most).
--     An envelope with no category is a plain pot: its money is set aside, nothing is spent from it.
--   * Its money is set aside from Spending money every month; spending in its categories comes out of the
--     envelope, not again out of Spending money. A recurring payment in an envelope's category counts in the
--     envelope, not in Fixed costs.
--   * Rollover off: at the end of each month the envelope settles with Spending money (leftover goes back,
--     overspending is taken from it). Rollover on: it stays in the envelope (capped at double; above the cap
--     goes back to Spending money).
--   * Monthly only from now on (the math still reads an old weekly row correctly).
-- The rows stay in public.budgets (rollover and limit history from 0076 keep working); budget_buckets rows
-- are copied in as envelopes with no category and then soft-deleted. Additive and safe to run twice.

alter table public.budgets add column if not exists name text;
alter table public.budgets add column if not exists position int not null default 0;
alter table public.budgets alter column category_id drop not null;

create table if not exists public.budget_categories (
  budget_id   uuid not null references public.budgets(id) on delete cascade,
  category_id uuid not null references public.categories(id) on delete cascade,
  user_id     uuid not null default auth.uid() references auth.users(id) on delete cascade,
  created_at  timestamptz not null default now(),
  primary key (budget_id, category_id)
);
-- A category belongs to one envelope at most
create unique index if not exists budget_categories_one_envelope on public.budget_categories (user_id, category_id);

alter table public.budget_categories enable row level security;
drop policy if exists "own rows" on public.budget_categories;
create policy "own rows" on public.budget_categories for all to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));

-- Existing category budgets: their category becomes the envelope's category
insert into public.budget_categories (budget_id, category_id, user_id)
select b.id, b.category_id, b.user_id
from public.budgets b
where b.deleted_at is null and b.category_id is not null
on conflict do nothing;

-- Extra buckets of the budget setup become envelopes with no category (an amount of 0 has nothing to keep)
do $$
declare r record; new_id uuid; m date;
begin
  if to_regclass('public.budget_buckets') is null then return; end if;
  for r in
    select bk.*, coalesce(us.timezone, 'America/Guayaquil') as tz
    from public.budget_buckets bk left join public.user_settings us on us.user_id = bk.user_id
    where bk.deleted_at is null
  loop
    if r.monthly_amount > 0 then
      m := date_trunc('month', now() at time zone r.tz)::date;
      insert into public.budgets (user_id, category_id, name, limit_amount, period, position, started_on)
      values (r.user_id, null, r.name, r.monthly_amount, 'monthly', 100 + coalesce(r.position, 0), m)
      returning id into new_id;
      insert into public.budget_limit_changes (user_id, budget_id, limit_amount, effective_from)
      values (r.user_id, new_id, r.monthly_amount, m)
      on conflict do nothing;
    end if;
    update public.budget_buckets set deleted_at = now() where id = r.id;
  end loop;
end $$;

select 'budget_categories rows' as checked, count(*)::text as found from public.budget_categories
union all
select 'budget_buckets left', count(*)::text from public.budget_buckets where deleted_at is null;
