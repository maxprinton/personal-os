-- Personal OS - 0020: notes work like Notion pages
--  · notes.page      page settings: icon, cover, coverY, font, small, full, locked, toc
--  · notes.parent_id sub-pages (a note inside another note)
--  · Storage bucket "note-files" (private, 50 MB per file) for images, PDFs, audio… in notes;
--    each user can only read and write their own folder (<user id>/…).

alter table public.notes add column if not exists page jsonb not null default '{}'::jsonb;
alter table public.notes add column if not exists parent_id uuid references public.notes(id) on delete set null;
create index if not exists notes_parent_idx on public.notes (user_id, parent_id) where deleted_at is null;

insert into storage.buckets (id, name, public, file_size_limit)
values ('note-files', 'note-files', false, 52428800)
on conflict (id) do update set public = false, file_size_limit = excluded.file_size_limit;

do $$
begin
  drop policy if exists "note files: read own" on storage.objects;
  drop policy if exists "note files: add own" on storage.objects;
  drop policy if exists "note files: change own" on storage.objects;
  drop policy if exists "note files: delete own" on storage.objects;
end $$;

create policy "note files: read own" on storage.objects for select to authenticated
  using (bucket_id = 'note-files' and (storage.foldername(name))[1] = auth.uid()::text);
create policy "note files: add own" on storage.objects for insert to authenticated
  with check (bucket_id = 'note-files' and (storage.foldername(name))[1] = auth.uid()::text);
create policy "note files: change own" on storage.objects for update to authenticated
  using (bucket_id = 'note-files' and (storage.foldername(name))[1] = auth.uid()::text);
create policy "note files: delete own" on storage.objects for delete to authenticated
  using (bucket_id = 'note-files' and (storage.foldername(name))[1] = auth.uid()::text);
