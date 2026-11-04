-- Admin review of project submissions. Apply after 003_dataforge.sql. Safe to re-run; adds only.
-- Why a migration: 003 has no place for reviewer comments or review history, and no "Rejected" status.
-- Checklist ticks stay as project_progress rows with task_id 'checklist:<task>' (see frontend lib/dataSync.ts).

-- 1. "Rejected" joins the allowed statuses. Existing values all remain valid.
alter table public.project_submissions drop constraint if exists project_submissions_status_check;
alter table public.project_submissions add constraint project_submissions_status_check
  check (status in ('Submitted', 'Under evaluation', 'Completed', 'Changes requested', 'Rejected'));

-- 2. Latest reviewer comment on the submission itself; the full trail is in submission_reviews.
alter table public.project_submissions add column if not exists review_comment text check (length(review_comment) <= 4000);

-- 3. Checklist rows can never count as a passed task. NOT VALID: existing rows are left untouched,
--    every new or updated row is checked.
alter table public.project_progress drop constraint if exists checklist_rows_never_pass;
alter table public.project_progress add constraint checklist_rows_never_pass
  check (task_id not like 'checklist:%' or passed = false) not valid;

-- Reviews are audited. Same list as 002 plus 'submission_review'.
alter table public.audit_log drop constraint if exists audit_log_action_check;
alter table public.audit_log add constraint audit_log_action_check check (action in
  ('signup', 'login', 'logout', 'submit', 'solve', 'mock_finish', 'password_change', 'role_change', 'progress_import',
   'solution_share', 'comment', 'comment_hide', 'submission_review'));

-- 4. Review history: one row per status change or comment, written only by the trigger below.
create table if not exists public.submission_reviews (
  id bigserial primary key,
  submission_id bigint not null references public.project_submissions (id) on delete cascade,
  reviewer_id uuid references auth.users (id),
  from_status text,
  to_status text not null,
  comment text check (length(comment) <= 4000),
  created_at timestamptz not null default now()
);
create index if not exists submission_reviews_sub_idx on public.submission_reviews (submission_id, created_at);
alter table public.submission_reviews enable row level security;

-- Submitters read the reviews of their own submissions; admins read all. Nobody inserts directly.
drop policy if exists submission_reviews_read on public.submission_reviews;
create policy submission_reviews_read on public.submission_reviews for select using (
  public.is_admin() or exists (select 1 from public.project_submissions s where s.id = submission_id and s.user_id = auth.uid())
);

-- 5. Submissions are stamped on insert and guarded on update:
--    - a learner's insert always starts as 'Submitted' with no reviewer fields
--    - only admins update; they may change only status and review_comment
--    - reviewer and time are set by the database, never by the client
--    - each update appends a submission_reviews row and an audit_log entry
create or replace function public.guard_submission() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    if auth.uid() is not null and not is_admin() then
      new.status := 'Submitted';
      new.reviewed_by := null;
      new.reviewed_at := null;
      new.review_comment := null;
    end if;
    return new;
  end if;

  -- auth.uid() is null for the service role (dashboard / scripts), which is allowed.
  if auth.uid() is not null and not is_admin() then
    raise exception 'only admins can review submissions';
  end if;
  if new.user_id is distinct from old.user_id or new.project_slug is distinct from old.project_slug
     or new.repo_url is distinct from old.repo_url or new.notes is distinct from old.notes
     or new.checklist is distinct from old.checklist or new.created_at is distinct from old.created_at then
    raise exception 'reviews may change only status and review_comment';
  end if;
  if new.status is not distinct from old.status and new.review_comment is not distinct from old.review_comment then
    return new;
  end if;
  new.reviewed_by := auth.uid();
  new.reviewed_at := now();
  insert into submission_reviews (submission_id, reviewer_id, from_status, to_status, comment)
    values (new.id, auth.uid(), old.status, new.status, new.review_comment);
  insert into audit_log (user_id, action, detail)
    values (auth.uid(), 'submission_review', jsonb_build_object('submission', new.id, 'project', new.project_slug, 'from', old.status, 'to', new.status));
  return new;
end $$;

drop trigger if exists guard_submission on public.project_submissions;
create trigger guard_submission before insert or update on public.project_submissions
  for each row execute function public.guard_submission();
