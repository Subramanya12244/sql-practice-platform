-- Learning activity and active-time tracking. Apply after 006_gamification.sql. Safe to re-run; adds only.
--
-- - learning_events: one row per tracked event; the client-generated UUID is the primary key, so a
--   retried batch is ignored instead of duplicated.
-- - active_minutes: one row per (user, UTC minute) with real interaction. The primary key makes
--   overlapping tabs and devices count a minute once.
-- - learning_sessions: start and last activity per session (duration ≠ active time).
-- Users insert only their own rows, timestamped within the last 7 days and not in the future
-- (offline queues drain later; nothing can be back- or forward-dated beyond that). Nobody edits or
-- deletes them. Admins read everything for analytics. Events are learner-reported estimates.

create table if not exists public.learning_events (
  id uuid primary key,
  user_id uuid not null references auth.users (id) on delete cascade,
  type text not null check (type in ('login', 'session_start', 'session_end', 'lesson_opened', 'lesson_completed',
    'sql_opened', 'sql_executed', 'sql_submitted', 'python_opened', 'python_executed', 'python_submitted',
    'project_started', 'project_completed', 'assessment_completed')),
  ref text check (length(ref) <= 200),
  meta jsonb not null default '{}'::jsonb check (pg_column_size(meta) <= 2000),
  session_id uuid,
  at timestamptz not null,
  received_at timestamptz not null default now()
);
create index if not exists learning_events_user_at_idx on public.learning_events (user_id, at desc);
create index if not exists learning_events_type_at_idx on public.learning_events (type, at desc);

create table if not exists public.active_minutes (
  user_id uuid not null references auth.users (id) on delete cascade,
  minute timestamptz not null check (date_trunc('minute', minute) = minute),
  primary key (user_id, minute)
);
create index if not exists active_minutes_minute_idx on public.active_minutes (minute);

create table if not exists public.learning_sessions (
  id uuid primary key,
  user_id uuid not null references auth.users (id) on delete cascade,
  started_at timestamptz not null,
  last_activity_at timestamptz not null,
  check (last_activity_at >= started_at)
);
create index if not exists learning_sessions_user_idx on public.learning_sessions (user_id, started_at desc);

alter table public.learning_events enable row level security;
alter table public.active_minutes enable row level security;
alter table public.learning_sessions enable row level security;

-- A timestamp a client may report: not in the future (1 minute of clock skew), at most 7 days old.
create or replace function public.reportable(t timestamptz) returns boolean
language sql stable as $$ select t <= now() + interval '1 minute' and t >= now() - interval '7 days' $$;

drop policy if exists learning_events_insert on public.learning_events;
create policy learning_events_insert on public.learning_events for insert with check (user_id = auth.uid() and public.reportable(at));
drop policy if exists learning_events_read on public.learning_events;
create policy learning_events_read on public.learning_events for select using (user_id = auth.uid() or public.is_admin());

drop policy if exists active_minutes_insert on public.active_minutes;
create policy active_minutes_insert on public.active_minutes for insert with check (user_id = auth.uid() and public.reportable(minute));
drop policy if exists active_minutes_read on public.active_minutes;
create policy active_minutes_read on public.active_minutes for select using (user_id = auth.uid() or public.is_admin());

drop policy if exists learning_sessions_insert on public.learning_sessions;
create policy learning_sessions_insert on public.learning_sessions for insert
  with check (user_id = auth.uid() and public.reportable(started_at) and public.reportable(last_activity_at));
-- Sessions may only move their last activity forward (upsert of an open session).
drop policy if exists learning_sessions_update on public.learning_sessions;
create policy learning_sessions_update on public.learning_sessions for update
  using (user_id = auth.uid()) with check (user_id = auth.uid() and public.reportable(last_activity_at));
drop policy if exists learning_sessions_read on public.learning_sessions;
create policy learning_sessions_read on public.learning_sessions for select using (user_id = auth.uid() or public.is_admin());

create or replace function public.guard_session_update() returns trigger
language plpgsql as $$
begin
  if new.user_id is distinct from old.user_id or new.started_at is distinct from old.started_at then
    raise exception 'sessions keep their owner and start time';
  end if;
  new.last_activity_at := greatest(old.last_activity_at, new.last_activity_at);
  return new;
end $$;
drop trigger if exists guard_session_update on public.learning_sessions;
create trigger guard_session_update before update on public.learning_sessions
  for each row execute function public.guard_session_update();

alter table public.audit_log drop constraint if exists audit_log_action_check;
alter table public.audit_log add constraint audit_log_action_check check (action in
  ('signup', 'login', 'logout', 'submit', 'solve', 'mock_finish', 'password_change', 'role_change', 'progress_import',
   'solution_share', 'comment', 'comment_hide', 'submission_review', 'admin_export', 'admin_view_learner'));
