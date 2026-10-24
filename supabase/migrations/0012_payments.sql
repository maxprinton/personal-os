-- Personal OS - Calendar v2, phase 7: payments are events.
--   payment_templates  what a payment pre-fills: account, category, expected amount, and how it
--                      repeats (none, or every N days / weeks / months / years from start_date)
--   events             is_payment + payment_template_id; payment_status = paid | skipped;
--                      payment_transaction_id = the real transaction once confirmed
--   transactions       event_id / payment_template_id: where a confirmed payment came from
-- On the day, the app shows a pre-filled draft: you type the real amount and confirm. Creating a
-- payment from Finance or from the calendar makes exactly the same records. Recurring payments
-- create their own events (about two months ahead). Requires 0008. Safe to run twice.

create table if not exists public.payment_templates (
  id               uuid primary key default gen_random_uuid(),
  user_id          uuid not null default auth.uid() references auth.users(id) on delete cascade,
  name             text not null check (length(trim(name)) > 0),
  type             transaction_type not null default 'expense',
  expected_amount  numeric(12,2) check (expected_amount is null or expected_amount > 0),
  account_id       uuid references public.accounts(id) on delete set null,
  category_id      uuid references public.categories(id) on delete set null,
  repeat_unit      text not null default 'none' check (repeat_unit in ('none', 'days', 'weeks', 'months', 'years')),
  repeat_every     integer not null default 1 check (repeat_every between 1 and 366),
  start_date       date not null,
  end_date         date,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  deleted_at       timestamptz,
  check (end_date is null or end_date >= start_date)
);

drop trigger if exists payment_templates_updated_at on public.payment_templates;
create trigger payment_templates_updated_at before update on public.payment_templates
  for each row execute function public.set_updated_at();
alter table public.payment_templates enable row level security;
drop policy if exists "own rows" on public.payment_templates;
create policy "own rows" on public.payment_templates for all to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));

alter table public.events
  add column if not exists is_payment boolean not null default false,
  add column if not exists payment_template_id uuid references public.payment_templates(id) on delete set null,
  add column if not exists payment_status text check (payment_status in ('paid', 'skipped')),
  add column if not exists payment_transaction_id uuid references public.transactions(id) on delete set null;

-- A template creates at most one event per date
create unique index if not exists events_payment_template_date_uq
  on public.events (payment_template_id, event_date) where payment_template_id is not null and deleted_at is null;

alter table public.transactions
  add column if not exists event_id uuid references public.events(id) on delete set null,
  add column if not exists payment_template_id uuid references public.payment_templates(id) on delete set null;
