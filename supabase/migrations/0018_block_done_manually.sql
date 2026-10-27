-- Personal OS - 0018: a block you mark done stays done
-- Before: marking a block done was recalculated right away from its habits AND its tasks, so a
-- block with pending tasks went back to "to do" (or "partial"). Now the ✓ is remembered.
-- Safe to run twice.

alter table public.block_occurrences
  add column if not exists done_manually boolean not null default false;
