-- Personal OS - 0075: core or add-on tag on Backlog items (BL-100). Safe to run twice.
-- Core = anything that is not an add-on. Every existing item stays core until you tag it.

alter table public.backlog_items
  add column if not exists scope text not null default 'core';

do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'backlog_items_scope_check') then
    alter table public.backlog_items add constraint backlog_items_scope_check check (scope in ('core', 'addon'));
  end if;
end $$;

-- The overview Claude reads at the start of a session: same columns as before, scope added at the end.
create or replace view public.backlog_overview with (security_invoker = true) as
select
  i.id,
  i.user_id,
  i.number,
  'BL-' || i.number as code,
  i.title,
  i.type,
  i.status,
  i.size,
  i.area,
  i.spec_link,
  i.position,
  i.reopened_count,
  floor(extract(epoch from (now() - i.status_changed_at)) / 86400)::integer as days_in_status,
  (i.status = 'verifying'
    and i.verifying_since is not null
    and now() - i.verifying_since >= make_interval(days => coalesce(
          (select s.verify_days from public.backlog_settings s where s.user_id = i.user_id), 7))) as verify_due,
  i.scope
from public.backlog_items i
where i.deleted_at is null;

-- How much waiting and shipped work is core and how much is add-on.
-- waiting = Inbox, Later, Next, Now. shipped = Verifying, Done.
create or replace view public.backlog_scope_counts with (security_invoker = true) as
select
  user_id,
  scope,
  count(*) filter (where status in ('inbox', 'later', 'next', 'now')) as waiting,
  count(*) filter (where status in ('verifying', 'done')) as shipped
from public.backlog_items
where deleted_at is null
group by user_id, scope;

-- Test mission probe: "an item was tagged add-on since <time>".
create or replace function public.tprobe_backlog_scope(p_user uuid, p_since timestamptz) returns boolean
  language sql stable set search_path to 'public'
  as $$ select exists (select 1 from backlog_items where user_id = p_user and scope = 'addon' and updated_at > p_since) $$;
