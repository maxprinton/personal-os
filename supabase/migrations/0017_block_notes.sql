-- Personal OS - 0017: block notes ("the name is the key", like LifeOS)
-- Every block name has one main note, shared by all its appearances. It is a normal row of
-- notes (tags, search, export) with block_name set. The link is the NAME, not the block id:
-- delete "Gym" and create "Gym" again later, and its note comes back by itself.
-- Safe to run twice.

alter table public.notes
  add column if not exists block_name text;

-- One live note per block name and user (case-insensitive)
create unique index if not exists notes_block_name_uq
  on public.notes (user_id, lower(block_name))
  where deleted_at is null and block_name is not null;
