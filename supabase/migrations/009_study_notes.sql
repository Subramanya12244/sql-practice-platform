-- Visual Learning Notes library. Apply after 008_admin_analytics.sql. Safe to re-run; adds only.
--
-- study_notes: one row per generated PDF (metadata only). The PDF itself lives in the private
-- Storage bucket "study-notes" at <user id>/<note id>.pdf. Learners can create, read and delete
-- only their own rows and files; nobody can update a note (a new version is a new note).
-- Admins get no access to learners' notes: they are the learner's own documents.

create table if not exists public.study_notes (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  title text not null check (length(title) between 1 and 120),
  kind text not null check (kind in ('sql', 'python', 'mixed')),
  topics text[] not null default '{}' check (cardinality(topics) <= 40),
  refs text[] not null default '{}' check (cardinality(refs) <= 300),
  options jsonb not null default '{}'::jsonb check (pg_column_size(options) <= 4000),
  pages int not null check (pages between 1 and 2000),
  size_bytes int not null check (size_bytes between 1 and 20971520),
  storage_path text not null,
  created_at timestamptz not null default now(),
  check (storage_path = user_id::text || '/' || id::text || '.pdf')
);
create index if not exists study_notes_user_idx on public.study_notes (user_id, created_at desc);
alter table public.study_notes enable row level security;

drop policy if exists study_notes_read on public.study_notes;
create policy study_notes_read on public.study_notes for select using (user_id = auth.uid());
drop policy if exists study_notes_insert on public.study_notes;
create policy study_notes_insert on public.study_notes for insert with check (user_id = auth.uid());
drop policy if exists study_notes_delete on public.study_notes;
create policy study_notes_delete on public.study_notes for delete using (user_id = auth.uid());

-- At most 100 saved notes per learner (storage is shared and free-tier sized).
create or replace function public.study_notes_limit() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if (select count(*) from study_notes where user_id = new.user_id) >= 100 then
    raise exception 'You have 100 saved notes; delete some before saving more.';
  end if;
  return new;
end $$;
drop trigger if exists study_notes_limit on public.study_notes;
create trigger study_notes_limit before insert on public.study_notes for each row execute function public.study_notes_limit();

-- ── Storage: private bucket, PDFs only, 20 MB each ───────────────────────
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('study-notes', 'study-notes', false, 20971520, array['application/pdf'])
on conflict (id) do update set public = false, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists study_notes_files_read on storage.objects;
create policy study_notes_files_read on storage.objects for select to authenticated
  using (bucket_id = 'study-notes' and (storage.foldername(name))[1] = auth.uid()::text);
drop policy if exists study_notes_files_insert on storage.objects;
create policy study_notes_files_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'study-notes' and (storage.foldername(name))[1] = auth.uid()::text and name ~ '^[0-9a-f-]{36}/[0-9a-f-]{36}\.pdf$');
drop policy if exists study_notes_files_delete on storage.objects;
create policy study_notes_files_delete on storage.objects for delete to authenticated
  using (bucket_id = 'study-notes' and (storage.foldername(name))[1] = auth.uid()::text);
