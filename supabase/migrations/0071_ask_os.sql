-- Personal OS - 0071: "Ask your notes" (@os) on the web keeps its conversations (BL-22).
-- A conversation is a list of messages (your question, the answer and the notes it used). You delete them yourself.
-- Additive and safe to run twice. Until it is run, @os on the web still answers but does not save the thread.

create table if not exists public.ask_conversations (
  id             uuid primary key default gen_random_uuid(),
  user_id        uuid not null default auth.uid() references auth.users(id) on delete cascade,
  title          text not null default '',
  focus_note_id  uuid references public.notes(id) on delete set null,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);
create index if not exists ask_conversations_user_idx on public.ask_conversations (user_id, updated_at desc);

create table if not exists public.ask_messages (
  id               uuid primary key default gen_random_uuid(),
  user_id          uuid not null default auth.uid() references auth.users(id) on delete cascade,
  conversation_id  uuid not null references public.ask_conversations(id) on delete cascade,
  role             text not null check (role in ('user', 'assistant')),
  content          text not null default '',
  sources          jsonb not null default '[]'::jsonb,
  depth            text check (depth in ('quick', 'normal', 'deep')),
  created_at       timestamptz not null default now()
);
create index if not exists ask_messages_conv_idx on public.ask_messages (conversation_id, created_at);

alter table public.ask_conversations enable row level security;
alter table public.ask_messages enable row level security;
drop policy if exists "own rows" on public.ask_conversations;
create policy "own rows" on public.ask_conversations for all to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
drop policy if exists "own rows" on public.ask_messages;
create policy "own rows" on public.ask_messages for all to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));

-- Test probes for the BL-22 missions (same pattern as 0068 and 0069).
create or replace function public.tprobe_ask_web(p_user uuid, p_since timestamptz) returns boolean
  language sql stable set search_path to 'public'
  as $$ select exists (select 1 from ask_messages where user_id = p_user and role = 'assistant' and created_at > p_since) $$;

create or replace function public.tprobe_ask_web_note(p_user uuid, p_since timestamptz) returns boolean
  language sql stable set search_path to 'public'
  as $$ select exists (select 1 from ask_conversations where user_id = p_user and focus_note_id is not null and created_at > p_since) $$;
