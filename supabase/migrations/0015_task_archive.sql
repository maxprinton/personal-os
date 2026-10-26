-- Personal OS - 0015: archive tasks
-- "Archived" = not done and not deleted: you decided not to do it. It leaves every list and block,
-- and can be restored from Tasks → Archived. Safe to run twice.

alter type public.task_status add value if not exists 'archived';

alter table public.tasks
  add column if not exists archived_at timestamptz;
