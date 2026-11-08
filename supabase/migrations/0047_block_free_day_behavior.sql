-- Personal OS - what each block does on a free day.
--   'pause' (default, same as always): its weekly appearances are paused (dimmed, streaks pause) on free days.
--   'keep': it stays active on free days (habits, ticks and streaks work as usual).
-- Additive and safe to run twice. Nothing existing changes: every block starts on 'pause'.
alter table public.block_types add column if not exists free_day_behavior text not null default 'pause';
do $$ begin
  alter table public.block_types add constraint block_types_free_day_behavior_chk check (free_day_behavior in ('pause', 'keep'));
exception when duplicate_object then null; end $$;
comment on column public.block_types.free_day_behavior is 'On a free day: pause = the weekly block is paused, keep = it stays active.';
