-- Personal OS - 0028: work log extras (adds to 0027, changes nothing that exists)
--  · work_classes.status          taught (default) · cancelled_early (a personalized student cancelled BEFORE the class
--                                 started: not a lost hour, reschedule if the student asks) · cancelled_late (cancelled once
--                                 the class had started: you are exempt, no balances, nothing in the monthly report).
--  · work_classes.attendance_urls screenshots of the attendance ("asistencia" in Notion), stored in the private
--                                 "note-files" bucket; each item is a "/api/files/..." link.
-- Safe to run twice.

alter table public.work_classes add column if not exists status text not null default 'taught';
alter table public.work_classes drop constraint if exists work_classes_status_check;
alter table public.work_classes add constraint work_classes_status_check check (status in ('taught', 'cancelled_early', 'cancelled_late'));
alter table public.work_classes add column if not exists attendance_urls text[] not null default '{}';
