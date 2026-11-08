-- Notes remember the name they had before they became the note of a calendar block / a portfolio page.
-- Used by the "Former" choice (rename it "Former · <name> · <date>" OR give it its previous name back) and by "Restore".
-- Shape: {"original": "My gym plan" | null, "former": "Former · Gym · Nov 8" | null, "scope": "block"|"portfolio",
--         "block": "Gym", "slotId": "...", "lang": "en", "at": "2026-11-08"}
-- Additive and safe to run twice. Nothing existing changes.
alter table public.notes add column if not exists name_memory jsonb;
comment on column public.notes.name_memory is 'The name this note had before it became a block / portfolio note, and the "Former" title it was given (for Restore).';
