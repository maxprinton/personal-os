-- Personal OS - 0073: Needs & Wants list in Finance (BL-116).
-- Things to buy, in two lists (Needed first, then Wanted). "Bought" saves a normal transaction and links it here.
-- Deleting that transaction (anywhere: Finance, an account page, Telegram undo) sends the item back to its list.
-- Additive and safe to run twice.

create table if not exists public.purchase_items (
  id              uuid primary key default gen_random_uuid(),
  user_id         uuid not null default auth.uid() references auth.users(id) on delete cascade,
  name            text not null check (length(btrim(name)) between 1 and 200),
  price           numeric(12,2) check (price is null or price > 0),
  kind            text not null default 'want' check (kind in ('need', 'want')),
  status          text not null default 'open' check (status in ('open', 'bought')),
  position        integer not null default 0,
  transaction_id  uuid references public.transactions(id) on delete set null,
  source          text not null default 'web' check (source in ('web', 'telegram')),
  bought_at       timestamptz,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  deleted_at      timestamptz
);
create index if not exists purchase_items_user_idx on public.purchase_items (user_id, status, kind, position) where deleted_at is null;
create index if not exists purchase_items_txn_idx on public.purchase_items (transaction_id) where transaction_id is not null;

-- The same name can't be twice in Needed/Wanted (case and extra spaces ignored). Bought and removed items don't count.
create unique index if not exists purchase_items_open_name_uniq
  on public.purchase_items (user_id, (regexp_replace(lower(btrim(name)), '\s+', ' ', 'g')))
  where status = 'open' and deleted_at is null;

drop trigger if exists purchase_items_updated_at on public.purchase_items;
create trigger purchase_items_updated_at before update on public.purchase_items
  for each row execute function public.set_updated_at();

alter table public.purchase_items enable row level security;
drop policy if exists "own rows" on public.purchase_items;
create policy "own rows" on public.purchase_items for all to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));

-- A bought item's transaction was deleted -> the item goes back to its list.
-- If an open item with the same name already exists, it stays Bought with no transaction (never breaks the delete).
create or replace function public.purchase_txn_deleted() returns trigger
  language plpgsql security definer set search_path to 'public'
as $$
declare r record;
begin
  if new.deleted_at is null or old.deleted_at is not null then
    return new;
  end if;
  for r in select id, user_id, name from purchase_items
           where transaction_id = new.id and status = 'bought' and deleted_at is null loop
    if exists (select 1 from purchase_items p
               where p.user_id = r.user_id and p.status = 'open' and p.deleted_at is null and p.id <> r.id
                 and regexp_replace(lower(btrim(p.name)), '\s+', ' ', 'g') = regexp_replace(lower(btrim(r.name)), '\s+', ' ', 'g')) then
      update purchase_items set transaction_id = null where id = r.id;
    else
      update purchase_items set status = 'open', transaction_id = null, bought_at = null,
        position = coalesce((select max(position) + 1 from purchase_items q
                             where q.user_id = r.user_id and q.status = 'open' and q.deleted_at is null
                               and q.kind = (select kind from purchase_items where id = r.id)), 0)
      where id = r.id;
    end if;
  end loop;
  return new;
end $$;

drop trigger if exists transactions_purchase_back on public.transactions;
create trigger transactions_purchase_back after update of deleted_at on public.transactions
  for each row execute function public.purchase_txn_deleted();

-- Test probes for the BL-116 missions (same pattern as 0068/0069/0071).
create or replace function public.tprobe_purchase_added(p_user uuid, p_since timestamptz) returns boolean
  language sql stable set search_path to 'public'
  as $$ select exists (select 1 from purchase_items where user_id = p_user and created_at > p_since) $$;

create or replace function public.tprobe_purchase_telegram(p_user uuid, p_since timestamptz) returns boolean
  language sql stable set search_path to 'public'
  as $$ select exists (select 1 from purchase_items where user_id = p_user and source = 'telegram' and created_at > p_since) $$;

create or replace function public.tprobe_purchase_bought(p_user uuid, p_since timestamptz) returns boolean
  language sql stable set search_path to 'public'
  as $$ select exists (select 1 from purchase_items where user_id = p_user and status = 'bought' and transaction_id is not null and bought_at > p_since) $$;
