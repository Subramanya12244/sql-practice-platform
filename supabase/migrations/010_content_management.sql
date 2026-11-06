-- Content management. Apply after 009_study_notes.sql. Safe to re-run; adds only.
--
-- The question bank ships with the site (files in the repo, prerendered for search engines).
-- Admins adjust it at runtime without a rebuild:
-- - question_overrides: per built-in question (kind sql|python, ref = question number or Python
--   slug): disable it, or change its title or difficulty, with an admin note. Everyone may read
--   overrides (the site applies them); only admins write.
-- - custom_questions: SQL questions created by admins (graded against the built-in Northwind
--   database like the rest). Readable by everyone only when published; admins see drafts too.
-- - question_versions: every insert/update of either table, written by triggers, admin-only.
--   Learner submissions reference questions by number/slug and are never rewritten, so history
--   is preserved across edits.

create table if not exists public.question_overrides (
  kind text not null check (kind in ('sql', 'python')),
  ref text not null check (length(ref) between 1 and 120),
  disabled boolean not null default false,
  title text check (title is null or length(title) between 1 and 160),
  difficulty text check (difficulty is null or difficulty in ('Easy', 'Medium', 'Hard')),
  note text check (note is null or length(note) <= 2000),
  version int not null default 1,
  updated_by uuid references auth.users (id) on delete set null,
  updated_at timestamptz not null default now(),
  primary key (kind, ref)
);

create table if not exists public.custom_questions (
  id uuid primary key default gen_random_uuid(),
  slug text unique not null check (slug ~ '^[a-z0-9][a-z0-9-]{2,80}$'),
  title text not null check (length(title) between 3 and 160),
  difficulty text not null check (difficulty in ('Easy', 'Medium', 'Hard')),
  topic text not null check (length(topic) between 2 and 80),
  concepts text[] not null default '{}' check (cardinality(concepts) <= 20),
  scenario text not null default '' check (length(scenario) <= 4000),
  problem text not null check (length(problem) between 10 and 8000),
  objective text not null check (length(objective) between 5 and 2000),
  expected_output text not null default '' check (length(expected_output) <= 4000),
  hints text[] not null default '{}' check (cardinality(hints) <= 10),
  explanation text not null default '' check (length(explanation) <= 8000),
  reference_query text not null check (length(reference_query) between 8 and 20000),
  sort_required boolean not null default false,
  published boolean not null default false,
  version int not null default 1,
  created_by uuid references auth.users (id) on delete set null default auth.uid(),
  updated_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.question_versions (
  id bigserial primary key,
  kind text not null check (kind in ('override', 'custom')),
  ref text not null,
  version int not null,
  data jsonb not null,
  changed_by uuid references auth.users (id) on delete set null,
  changed_at timestamptz not null default now()
);
create index if not exists question_versions_ref_idx on public.question_versions (kind, ref, version desc);

alter table public.question_overrides enable row level security;
alter table public.custom_questions enable row level security;
alter table public.question_versions enable row level security;

drop policy if exists question_overrides_read on public.question_overrides;
create policy question_overrides_read on public.question_overrides for select using (true);
drop policy if exists question_overrides_write on public.question_overrides;
create policy question_overrides_write on public.question_overrides for all using (public.is_admin()) with check (public.is_admin());

drop policy if exists custom_questions_read on public.custom_questions;
create policy custom_questions_read on public.custom_questions for select using (published or public.is_admin());
drop policy if exists custom_questions_write on public.custom_questions;
create policy custom_questions_write on public.custom_questions for all using (public.is_admin()) with check (public.is_admin());

drop policy if exists question_versions_read on public.question_versions;
create policy question_versions_read on public.question_versions for select using (public.is_admin());

-- Versioning: bump the version, stamp who/when, and append the new row to question_versions.
create or replace function public.version_question() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  k text := case when tg_table_name = 'question_overrides' then 'override' else 'custom' end;
  j jsonb;
  r text;
begin
  if tg_op = 'UPDATE' then
    new.version := old.version + 1;
  end if;
  new.updated_by := auth.uid();
  new.updated_at := now();
  -- Fields differ per table, so read them through jsonb (a missing record field is an error).
  j := to_jsonb(new);
  r := case when k = 'override' then (j ->> 'kind') || ':' || (j ->> 'ref') else j ->> 'slug' end;
  insert into question_versions (kind, ref, version, data, changed_by)
    values (k, r, new.version, j, auth.uid());
  return new;
end $$;
drop trigger if exists version_override on public.question_overrides;
create trigger version_override before insert or update on public.question_overrides for each row execute function public.version_question();
drop trigger if exists version_custom on public.custom_questions;
create trigger version_custom before insert or update on public.custom_questions for each row execute function public.version_question();

-- Content edits are audited like other admin actions.
alter table public.audit_log drop constraint if exists audit_log_action_check;
alter table public.audit_log add constraint audit_log_action_check check (action in
  ('signup', 'login', 'logout', 'submit', 'solve', 'mock_finish', 'password_change', 'role_change', 'progress_import',
   'solution_share', 'comment', 'comment_hide', 'submission_review', 'admin_export', 'admin_view_learner', 'content_edit'));
drop policy if exists audit_insert_own on public.audit_log;
create policy audit_insert_own on public.audit_log for insert
  with check (user_id = auth.uid() and action not in ('signup', 'role_change', 'admin_export', 'admin_view_learner', 'content_edit'));

create or replace function public.audit_content() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  j jsonb := case when tg_op = 'DELETE' then to_jsonb(old) else to_jsonb(new) end;
begin
  insert into audit_log (user_id, action, detail) values (auth.uid(), 'content_edit', jsonb_build_object(
    'table', tg_table_name, 'op', tg_op,
    'ref', case when tg_table_name = 'question_overrides' then (j ->> 'kind') || ':' || (j ->> 'ref') else j ->> 'slug' end));
  return case when tg_op = 'DELETE' then old else new end;
end $$;
drop trigger if exists audit_override on public.question_overrides;
create trigger audit_override after insert or update or delete on public.question_overrides for each row execute function public.audit_content();
drop trigger if exists audit_custom on public.custom_questions;
create trigger audit_custom after insert or update or delete on public.custom_questions for each row execute function public.audit_content();
