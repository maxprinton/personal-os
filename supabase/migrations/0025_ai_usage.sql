-- Personal OS - 0025: AI usage (Groq)
--  · ai_usage  one row per AI call the app makes: when, which feature (Telegram, notes, writing…),
--    which model, tokens, and what Groq said is left (requests today, tokens this minute).
--  · ai_usage_summary(from, tz, user)  totals by day, model and feature in one answer.
-- Groq has no API to ask for your usage, so the app keeps its own record. Safe to run twice.

create table if not exists public.ai_usage (
  id                  bigserial primary key,
  user_id             uuid not null default auth.uid() references auth.users(id) on delete cascade,
  at                  timestamptz not null default now(),
  feature             text not null default 'other',
  model               text not null default '',
  prompt_tokens       integer not null default 0,
  completion_tokens   integer not null default 0,
  remaining_requests  integer,
  limit_requests      integer,
  remaining_tokens    integer,
  limit_tokens        integer
);
create index if not exists ai_usage_user_at_idx on public.ai_usage (user_id, at desc);
alter table public.ai_usage enable row level security;
drop policy if exists "own rows" on public.ai_usage;
create policy "own rows" on public.ai_usage for all to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));

create or replace function public.ai_usage_summary(p_from timestamptz, p_tz text default 'America/Guayaquil', p_user uuid default null)
returns jsonb language sql stable security invoker set search_path = public as $$
  with mine as (
    select * from public.ai_usage
     where user_id = coalesce(p_user, auth.uid()) and at >= p_from
  )
  select jsonb_build_object(
    'rows', coalesce((
      select jsonb_agg(jsonb_build_object('day', d, 'model', model, 'feature', feature, 'calls', calls, 'tokens', tokens))
        from (select (at at time zone p_tz)::date as d, model, feature, count(*) as calls,
                     sum(prompt_tokens + completion_tokens) as tokens
                from mine group by 1, 2, 3) g), '[]'::jsonb),
    'latest', coalesce((
      select jsonb_agg(jsonb_build_object('model', model, 'at', at, 'remaining_requests', remaining_requests,
                                          'limit_requests', limit_requests, 'remaining_tokens', remaining_tokens, 'limit_tokens', limit_tokens))
        from (select distinct on (model) * from mine where remaining_requests is not null order by model, at desc) l), '[]'::jsonb)
  );
$$;
