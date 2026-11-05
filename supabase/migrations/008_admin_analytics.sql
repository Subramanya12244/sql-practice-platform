-- Admin analytics. Apply after 007_activity_tracking.sql. Safe to re-run; adds functions only.
--
-- Every function is security definer, checks is_admin() first and raises 'forbidden' otherwise,
-- and is revoked from anon. Numbers come from the tables learners already write:
-- active_minutes and learning_events (007), learning_sessions, progress, profiles.state.lessons
-- (Python completions, keyed "py:<slug>"), mock_sessions. Active time and accuracy are
-- learner-reported estimates (see 007).
--
-- Sensitive admin actions (viewing one learner, exporting data) are written to audit_log by
-- admin_audit(); learners can no longer write those action names themselves.

-- ── Audit ────────────────────────────────────────────────────────────────
-- Re-assert the full action list (re-running an older migration would otherwise narrow it).
alter table public.audit_log drop constraint if exists audit_log_action_check;
alter table public.audit_log add constraint audit_log_action_check check (action in
  ('signup', 'login', 'logout', 'submit', 'solve', 'mock_finish', 'password_change', 'role_change', 'progress_import',
   'solution_share', 'comment', 'comment_hide', 'submission_review', 'admin_export', 'admin_view_learner'));
drop policy if exists audit_insert_own on public.audit_log;
create policy audit_insert_own on public.audit_log for insert
  with check (user_id = auth.uid() and action not in ('signup', 'role_change', 'admin_export', 'admin_view_learner'));

create or replace function public.admin_audit(p_action text, p_detail jsonb default '{}'::jsonb) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not is_admin() then raise exception 'forbidden'; end if;
  if p_action not in ('admin_export', 'admin_view_learner') then raise exception 'unsupported audit action %', p_action; end if;
  if pg_column_size(p_detail) > 2000 then raise exception 'detail too large'; end if;
  insert into audit_log (user_id, action, detail) values (auth.uid(), p_action, coalesce(p_detail, '{}'::jsonb));
end $$;

-- Python completions from the synced progress blob: one row per (user, slug, day).
create or replace function public.py_completions() returns table (user_id uuid, slug text, day date)
language sql stable security definer set search_path = public as $$
  select p.id, substr(l.key, 4), left(l.value, 10)::date
  from profiles p, jsonb_each_text(coalesce(p.state -> 'lessons', '{}'::jsonb)) l
  where l.key like 'py:%' and l.value ~ '^\d{4}-\d{2}-\d{2}';
$$;
revoke all on function public.py_completions() from public, anon, authenticated;

-- ── Overview for a date range (inclusive, UTC days) ──────────────────────
create or replace function public.admin_overview(p_from date, p_to date) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  lo timestamptz := p_from::timestamptz;
  hi timestamptz := (p_to + 1)::timestamptz;
  anchor timestamptz := (p_to + 1)::timestamptz;
begin
  if not is_admin() then raise exception 'forbidden'; end if;
  if p_from is null or p_to is null or p_to < p_from or p_to - p_from > 366 then raise exception 'invalid range'; end if;
  return (
    with active as (
      select user_id, minute as t from active_minutes where minute >= least(lo, anchor - interval '30 days') and minute < greatest(hi, anchor)
      union all
      select user_id, at from learning_events where at >= least(lo, anchor - interval '30 days') and at < greatest(hi, anchor)
    ),
    ev as (select * from learning_events where at >= lo and at < hi),
    days as (select d::date as day from generate_series(p_from, p_to, interval '1 day') d)
    select jsonb_build_object(
      'users', (select count(*) from profiles),
      'dau', (select count(distinct user_id) from active where t >= anchor - interval '1 day' and t < anchor),
      'wau', (select count(distinct user_id) from active where t >= anchor - interval '7 days' and t < anchor),
      'mau', (select count(distinct user_id) from active where t >= anchor - interval '30 days' and t < anchor),
      'activeUsers', (select count(distinct user_id) from active where t >= lo and t < hi),
      'registrations', (select count(*) from profiles where created_at >= lo and created_at < hi),
      'sessions', (select count(*) from learning_sessions where started_at >= lo and started_at < hi),
      'avgSessionMin', (select round(avg(extract(epoch from last_activity_at - started_at) / 60)::numeric, 1)
                          from learning_sessions where started_at >= lo and started_at < hi),
      'activeMinutes', (select count(*) from active_minutes where minute >= lo and minute < hi),
      'avgActiveMinPerUser', (select round(count(*)::numeric / nullif(count(distinct user_id), 0), 1)
                                from active_minutes where minute >= lo and minute < hi),
      'sqlSubmits', (select count(*) from ev where type = 'sql_submitted'),
      'sqlPassed', (select count(*) from ev where type = 'sql_submitted' and (meta ->> 'passed')::boolean),
      'sqlSolves', (select count(*) from progress where solved_at >= lo and solved_at < hi),
      'pySubmits', (select count(*) from ev where type = 'python_submitted'),
      'pyPassed', (select count(*) from ev where type = 'python_submitted' and (meta ->> 'passed')::boolean),
      'pySolves', (select count(*) from py_completions() c where c.day >= p_from and c.day <= p_to),
      'lessonsCompleted', (select count(*) from ev where type = 'lesson_completed'),
      'projectsCompleted', (select count(*) from ev where type = 'project_completed'),
      'assessments', (select count(*) from mock_sessions where created_at >= lo and created_at < hi),
      'trend', (
        select coalesce(jsonb_agg(jsonb_build_object(
          'day', d.day,
          'activeUsers', (select count(distinct user_id) from active a where a.t >= d.day::timestamptz and a.t < (d.day + 1)::timestamptz),
          'activeMinutes', (select count(*) from active_minutes m where m.minute >= d.day::timestamptz and m.minute < (d.day + 1)::timestamptz),
          'signups', (select count(*) from profiles p where p.created_at >= d.day::timestamptz and p.created_at < (d.day + 1)::timestamptz),
          'sqlSubmits', (select count(*) from ev e where e.type = 'sql_submitted' and e.at >= d.day::timestamptz and e.at < (d.day + 1)::timestamptz),
          'pySubmits', (select count(*) from ev e where e.type = 'python_submitted' and e.at >= d.day::timestamptz and e.at < (d.day + 1)::timestamptz)
        ) order by d.day), '[]'::jsonb) from days d)
    )
  );
end $$;

-- ── One row per learner, for search, filters, sorting and CSV ────────────
create or replace function public.admin_learners() returns table (
  id uuid, username text, role text, created_at timestamptz, last_seen_at timestamptz, last_activity_at timestamptz,
  sql_solved bigint, sql_attempts bigint, sql_submits bigint, sql_passed bigint,
  py_solved bigint, py_submits bigint, py_passed bigint,
  active_min_7d bigint, active_min_30d bigint, active_min_total bigint, sessions bigint, mocks bigint)
language plpgsql stable security definer set search_path = public as $$
begin
  if not is_admin() then raise exception 'forbidden'; end if;
  return query
    select p.id, p.username::text, p.role, p.created_at, p.last_seen_at,
      greatest((select max(e.at) from learning_events e where e.user_id = p.id),
               (select max(m.minute) from active_minutes m where m.user_id = p.id), p.last_seen_at),
      (select count(*) from progress g where g.user_id = p.id and g.solved_at is not null),
      (select coalesce(sum(g.attempts), 0)::bigint from progress g where g.user_id = p.id),
      (select count(*) from learning_events e where e.user_id = p.id and e.type = 'sql_submitted'),
      (select count(*) from learning_events e where e.user_id = p.id and e.type = 'sql_submitted' and (e.meta ->> 'passed')::boolean),
      (select count(*) from py_completions() c where c.user_id = p.id),
      (select count(*) from learning_events e where e.user_id = p.id and e.type = 'python_submitted'),
      (select count(*) from learning_events e where e.user_id = p.id and e.type = 'python_submitted' and (e.meta ->> 'passed')::boolean),
      (select count(*) from active_minutes m where m.user_id = p.id and m.minute >= now() - interval '7 days'),
      (select count(*) from active_minutes m where m.user_id = p.id and m.minute >= now() - interval '30 days'),
      (select count(*) from active_minutes m where m.user_id = p.id),
      (select count(*) from learning_sessions s where s.user_id = p.id),
      (select count(*) from mock_sessions k where k.user_id = p.id)
    from profiles p
    order by p.created_at;
end $$;

-- ── One learner over a range; viewing it is audited ──────────────────────
create or replace function public.admin_learner_activity(p_user uuid, p_from date, p_to date) returns jsonb
language plpgsql volatile security definer set search_path = public as $$
declare
  lo timestamptz := p_from::timestamptz;
  hi timestamptz := (p_to + 1)::timestamptz;
begin
  if not is_admin() then raise exception 'forbidden'; end if;
  if p_from is null or p_to is null or p_to < p_from or p_to - p_from > 366 then raise exception 'invalid range'; end if;
  insert into audit_log (user_id, action, detail)
    values (auth.uid(), 'admin_view_learner', jsonb_build_object('learner', p_user, 'from', p_from, 'to', p_to));
  return jsonb_build_object(
    'days', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'day', d::date,
        'minutes', (select count(*) from active_minutes m where m.user_id = p_user and m.minute >= d and m.minute < d + interval '1 day'),
        'sql', (select count(*) from learning_events e where e.user_id = p_user and e.type = 'sql_submitted' and e.at >= d and e.at < d + interval '1 day'),
        'python', (select count(*) from learning_events e where e.user_id = p_user and e.type = 'python_submitted' and e.at >= d and e.at < d + interval '1 day'),
        'lessons', (select count(*) from learning_events e where e.user_id = p_user and e.type in ('lesson_opened', 'lesson_completed') and e.at >= d and e.at < d + interval '1 day')
      ) order by d), '[]'::jsonb)
      from generate_series(lo, hi - interval '1 day', interval '1 day') d),
    'sessions', (
      select coalesce(jsonb_agg(s order by s.started_at desc), '[]'::jsonb)
      from (select started_at, last_activity_at from learning_sessions
            where user_id = p_user and started_at >= lo and started_at < hi order by started_at desc limit 50) s),
    'problems', (
      select coalesce(jsonb_agg(r order by r.fails desc, r.ref), '[]'::jsonb)
      from (select type, ref, count(*) as submits, count(*) filter (where (meta ->> 'passed')::boolean) as passed,
                   count(*) filter (where not coalesce((meta ->> 'passed')::boolean, false)) as fails
            from learning_events where user_id = p_user and type in ('sql_submitted', 'python_submitted') and at >= lo and at < hi
            group by type, ref) r)
  );
end $$;

-- ── Per-problem results over a range (failed questions, difficult topics) ─
create or replace function public.admin_problem_stats(p_from date, p_to date) returns table (
  kind text, ref text, submits bigint, passed bigint, hidden_failed bigint, learners bigint)
language plpgsql stable security definer set search_path = public as $$
begin
  if not is_admin() then raise exception 'forbidden'; end if;
  if p_from is null or p_to is null or p_to < p_from or p_to - p_from > 366 then raise exception 'invalid range'; end if;
  return query
    select case when e.type = 'sql_submitted' then 'sql' else 'python' end, e.ref,
      count(*), count(*) filter (where (e.meta ->> 'passed')::boolean),
      count(*) filter (where (e.meta ->> 'hidden_failed')::boolean), count(distinct e.user_id)
    from learning_events e
    where e.type in ('sql_submitted', 'python_submitted') and e.ref is not null
      and e.at >= p_from::timestamptz and e.at < (p_to + 1)::timestamptz
    group by 1, 2;
end $$;

do $$
declare f text;
begin
  foreach f in array array['admin_audit(text, jsonb)', 'admin_overview(date, date)', 'admin_learners()',
                           'admin_learner_activity(uuid, date, date)', 'admin_problem_stats(date, date)'] loop
    execute format('revoke all on function public.%s from public, anon', f);
    execute format('grant execute on function public.%s to authenticated', f);
  end loop;
end $$;
