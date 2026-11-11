-- Personal OS - 0055: Telegram module — your own command words.
-- A row either ADDS a word for a bot feature ("/hoy2" also opens Today) or HIDES one of the built-in words
-- (the bot then answers "that word was renamed, use …"). Features that touch money or the system itself
-- (locked in src/lib/bot/registry.ts) accept new words but never hide the originals; the server checks that.
-- Only the server writes here (no insert/update/delete policy); you can read your own rows.
-- Additive and safe to run twice. Nothing existing changes.

create table if not exists public.bot_vocab (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  feature_id text not null,
  word text not null,
  kind text not null check (kind in ('add', 'hide')),
  created_at timestamptz not null default now(),
  unique (user_id, feature_id, kind, word)
);
create index if not exists bot_vocab_user_idx on public.bot_vocab (user_id);

alter table public.bot_vocab enable row level security;
drop policy if exists "bot_vocab read own rows" on public.bot_vocab;
create policy "bot_vocab read own rows" on public.bot_vocab for select to authenticated
  using (user_id = auth.uid());

comment on table public.bot_vocab is 'Telegram module: user command words. add = extra word for a feature, hide = built-in word turned off (never for locked features).';
