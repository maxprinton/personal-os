-- Personal OS - 0016: scheduled payments fully editable
--   events.payment_origin_date      the date the series gave this payment. It never changes, so a
--                                   payment moved to another day is not created again on its old day.
--   events.payment_expected_amount  this payment's own expected amount ("edit only this one");
--                                   null = the series amount.
-- Requires 0012. Safe to run twice.

alter table public.events
  add column if not exists payment_origin_date date,
  add column if not exists payment_expected_amount numeric(12,2)
    check (payment_expected_amount is null or payment_expected_amount > 0);

update public.events
   set payment_origin_date = event_date
 where payment_template_id is not null and payment_origin_date is null;

-- One event per series date: by its original date now (a moved payment may share a day with another)
drop index if exists public.events_payment_template_date_uq;
create unique index if not exists events_payment_template_origin_uq
  on public.events (payment_template_id, payment_origin_date)
  where payment_template_id is not null and deleted_at is null;
