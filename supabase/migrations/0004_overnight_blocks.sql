-- Personal OS - Phase 9: time blocks may cross midnight (e.g. 23:00 -> 01:00).
-- end_time < start_time now means "ends the next day". Only equal times are rejected.
do $$
declare c record;
begin
  for c in
    select conname from pg_constraint
     where conrelid = 'public.time_blocks'::regclass and contype = 'c'
       and pg_get_constraintdef(oid) ilike '%end_time > start_time%'
  loop
    execute format('alter table public.time_blocks drop constraint %I', c.conname);
  end loop;
end $$;

alter table public.time_blocks
  add constraint time_blocks_not_zero_length check (end_time <> start_time);
