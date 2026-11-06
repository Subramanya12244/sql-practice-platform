-- Admin question insights and per-learner extras. Apply after 011_assessments.sql. Adds functions only.
-- Same rules as 008: security definer, is_admin() checked first, not callable by anon.

-- Per problem over a range: who opened it, checks, passes, hidden-test failures, learners who
-- checked it, and the median first-solve time (SQL, from the solveSec learners' browsers record).
create or replace function public.admin_question_insights(p_from date, p_to date) returns table (
  kind text, ref text, opened_by bigint, submits bigint, passed bigint, hidden_failed bigint, learners bigint, median_solve_sec numeric)
language plpgsql stable security definer set search_path = public as $$
begin
  if not is_admin() then raise exception 'forbidden'; end if;
  if p_from is null or p_to is null or p_to < p_from or p_to - p_from > 366 then raise exception 'invalid range'; end if;
  return query
    with ev as (
      select * from learning_events e where e.at >= p_from::timestamptz and e.at < (p_to + 1)::timestamptz and e.ref is not null
    ),
    opened as (
      select case when e.type = 'sql_opened' then 'sql' else 'python' end as k, e.ref as r, count(distinct e.user_id) as n
      from ev e where e.type in ('sql_opened', 'python_opened') group by 1, 2
    ),
    checks as (
      select case when e.type = 'sql_submitted' then 'sql' else 'python' end as k, e.ref as r, count(*) as s,
             count(*) filter (where (e.meta ->> 'passed')::boolean) as p,
             count(*) filter (where (e.meta ->> 'hidden_failed')::boolean) as h,
             count(distinct e.user_id) as l
      from ev e where e.type in ('sql_submitted', 'python_submitted') group by 1, 2
    ),
    solve as (
      select 'sql'::text as k, 'q' || m.key as r, percentile_cont(0.5) within group (order by (m.value ->> 'solveSec')::numeric) as med
      from profiles pr, jsonb_each(coalesce(pr.state -> 'qmeta', '{}'::jsonb)) m
      where (m.value ->> 'solveSec') ~ '^[0-9]+(\.[0-9]+)?$'
      group by 1, 2
    )
    select coalesce(c.k, o.k), coalesce(c.r, o.r), coalesce(o.n, 0), coalesce(c.s, 0), coalesce(c.p, 0), coalesce(c.h, 0), coalesce(c.l, 0), round(sv.med::numeric, 0)
    from checks c full join opened o on o.k = c.k and o.r = c.r
    left join solve sv on sv.k = coalesce(c.k, o.k) and sv.r = coalesce(c.r, o.r);
end $$;

-- Per learner: assessments, projects, revision backlog (from the synced revision schedule).
create or replace function public.admin_learner_extras() returns table (
  id uuid, assessments bigint, avg_score numeric, projects_started bigint, projects_completed bigint, revision_due bigint)
language plpgsql stable security definer set search_path = public as $$
begin
  if not is_admin() then raise exception 'forbidden'; end if;
  return query
    select p.id,
      (select count(*) from assessment_attempts a where a.user_id = p.id and a.submitted_at is not null),
      (select round(avg(100.0 * a.score / nullif(a.total, 0)), 1) from assessment_attempts a where a.user_id = p.id and a.submitted_at is not null),
      (select count(distinct pp.project_slug) from project_progress pp where pp.user_id = p.id),
      (select count(distinct s.project_slug) from project_submissions s where s.user_id = p.id and s.status = 'Completed'),
      (select count(*) from jsonb_each(coalesce(p.state -> 'revision', '{}'::jsonb)) r where (r.value ->> 'due') <= to_char(now() at time zone 'utc', 'YYYY-MM-DD'))
    from profiles p;
end $$;

do $$
declare f text;
begin
  foreach f in array array['admin_question_insights(date, date)', 'admin_learner_extras()'] loop
    execute format('revoke all on function public.%s from public, anon', f);
    execute format('grant execute on function public.%s to authenticated', f);
  end loop;
end $$;
