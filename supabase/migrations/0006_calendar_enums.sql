-- Personal OS - Calendar v2, step 1 of the base model.
-- New entity type so notes can be linked to a block type (the block as a concept).
-- Run this file ON ITS OWN, before 0007: Postgres only lets a new enum value be used
-- after the statement that adds it has been committed.

alter type entity_type add value if not exists 'block_type';
