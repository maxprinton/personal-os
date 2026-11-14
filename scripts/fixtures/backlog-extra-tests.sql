-- Extra trigger tests (beyond the shared scenario table). Run by scripts/test-backlog-sql.mjs with ON_ERROR_STOP.
-- Each block raises an exception when something is wrong; a passing block prints "EXTRA|<name>|ok".
\set ON_ERROR_STOP on

do $$
declare a public.backlog_items; ev int; v_by text;
begin
  delete from public.backlog_events; delete from public.backlog_items;

  -- backlog_add puts one sentence into the Inbox for the only user, logged as claude
  a := public.backlog_add('Try the thing');
  if a.status <> 'inbox' or a.source <> 'claude' or a.number is null then raise exception 'backlog_add wrong: %', a; end if;
  select by into v_by from public.backlog_events where item_id = a.id;
  if v_by <> 'claude' then raise exception 'event by should be claude, got %', v_by; end if;

  -- title is trimmed, empty title rejected
  begin
    perform public.backlog_add('   ');
    raise exception 'empty title was accepted';
  exception when check_violation then null; end;

  raise notice 'EXTRA|add and log|ok';
end $$;

do $$
declare a public.backlog_items; b public.backlog_items; ev int; pos1 double precision; pos2 double precision;
begin
  delete from public.backlog_events; delete from public.backlog_items;
  a := public.backlog_add('First');
  b := public.backlog_add('Second');
  if b.position <= a.position then raise exception 'second item should be below the first'; end if;

  -- move with size + spec through backlog_move, then verifying -> done sets the timestamps
  a := public.backlog_move(a.number, 'next', 'user', null, null, 'S', null);
  a := public.backlog_move(a.number, 'now', 'claude', 'starting', null, null, 'claude/x.md');
  if a.status <> 'now' then raise exception 'not in now'; end if;
  a := public.backlog_move(a.number, 'verifying');
  if a.verifying_since is null then raise exception 'verifying_since not set'; end if;
  a := public.backlog_move(a.number, 'done');
  if a.done_at is null then raise exception 'done_at not set'; end if;
  if a.verifying_since is not null then raise exception 'verifying_since should clear on done'; end if;

  select count(*) into ev from public.backlog_events where item_id = a.id;
  if ev <> 5 then raise exception 'expected 5 events (insert + 4 moves), got %', ev; end if;

  -- reopen from done: back to Now, counted, done_at cleared
  a := public.backlog_move(a.number, 'now');
  if a.reopened_count <> 1 or a.done_at is not null then raise exception 'reopen wrong: %', a; end if;

  -- note and by are logged
  if not exists (select 1 from public.backlog_events where item_id = a.id and note = 'starting' and by = 'claude') then
    raise exception 'event with note/by missing';
  end if;

  raise notice 'EXTRA|moves, timestamps, reopen, events|ok';
end $$;

do $$
declare a public.backlog_items;
begin
  delete from public.backlog_events; delete from public.backlog_items;
  a := public.backlog_add('Park me');
  a := public.backlog_move(a.number, 'parked', 'user', null, 'Not now');
  if a.parked_reason <> 'Not now' then raise exception 'reason not saved'; end if;
  a := public.backlog_move(a.number, 'later');
  if a.parked_reason is not null then raise exception 'reason should clear when leaving parked'; end if;
  begin
    perform public.backlog_move(999999, 'later');
    raise exception 'missing item was accepted';
  exception when others then
    if sqlerrm not like 'BL-999999 not found.' then raise; end if;
  end;
  raise notice 'EXTRA|parked reason and missing item|ok';
end $$;

do $$
declare a public.backlog_items; due boolean;
begin
  delete from public.backlog_events; delete from public.backlog_items;
  a := public.backlog_add('Check me', 'bug');
  a := public.backlog_move(a.number, 'now');
  a := public.backlog_move(a.number, 'verifying');
  select verify_due into due from public.backlog_overview where number = a.number;
  if due then raise exception 'should not be due yet'; end if;
  update public.backlog_items set verifying_since = now() - interval '8 days' where id = a.id;
  select verify_due into due from public.backlog_overview where number = a.number;
  if not due then raise exception 'should be due after 8 days (default 7)'; end if;
  update public.backlog_settings set verify_days = 10;
  select verify_due into due from public.backlog_overview where number = a.number;
  if due then raise exception 'should not be due with verify_days = 10'; end if;
  update public.backlog_settings set verify_days = 7;
  raise notice 'EXTRA|verify due|ok';
end $$;

do $$
declare a public.backlog_items;
begin
  -- bugs do not count toward the Now cap, so a feature can still enter Now next to bugs
  delete from public.backlog_events; delete from public.backlog_items;
  perform public.backlog_move((public.backlog_add('bug 1', 'bug')).number, 'now');
  perform public.backlog_move((public.backlog_add('bug 2', 'bug')).number, 'now');
  perform public.backlog_move((public.backlog_add('bug 3', 'bug')).number, 'now');
  a := public.backlog_add('feature A');
  a := public.backlog_move(a.number, 'next', 'user', null, null, 'S', null);
  a := public.backlog_move(a.number, 'now', 'user', null, null, null, 'claude/a.md');
  if a.status <> 'now' then raise exception 'feature should enter Now next to 3 bugs'; end if;
  raise notice 'EXTRA|bugs do not count toward the cap|ok';
end $$;

do $$
declare cnt int;
begin
  -- RLS is on for all three tables and a view exists
  select count(*) into cnt from pg_class c join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public' and c.relname in ('backlog_items', 'backlog_events', 'backlog_settings') and c.relrowsecurity;
  if cnt <> 3 then raise exception 'RLS not enabled on all three tables (%)', cnt; end if;
  if not exists (select 1 from pg_views where schemaname = 'public' and viewname = 'backlog_overview') then
    raise exception 'view missing';
  end if;
  raise notice 'EXTRA|rls and view|ok';
end $$;
