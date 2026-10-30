-- Personal OS - 0022: notes you can link to a block (Replace / Merge)
--  · notes.merged_into  when a note is merged into another one it is soft-deleted and points here,
--    so old links (/notes/<id>) open the note it went into. Its NOTE number is never reused.
-- Safe to run twice.

alter table public.notes
  add column if not exists merged_into uuid references public.notes(id) on delete set null;

create index if not exists notes_merged_into_idx
  on public.notes (merged_into) where merged_into is not null;
