-- Gamification: XP ledger, achievements, missions, streak bonus and XP leaderboard.
-- Apply after 005_public_portfolio.sql. Safe to re-run. Adds objects only; no existing table changes.
--
-- Security model
-- - XP is awarded only by SECURITY DEFINER triggers on the tables the app already syncs
--   (progress, profiles.state, mock_sessions, project_progress, project_submissions).
-- - xp_events and user_achievements have SELECT policies only, so no client can insert, edit or
--   delete XP, achievements or mission rewards. award_xp() and friends are not executable by
--   anon/authenticated.
-- - Every award has a unique (user_id, source_key), so replays, re-syncs and double submits never
--   pay twice (idempotent).
-- - Honest limit: SQL, Python and project checks are graded in the browser, so the source rows are
--   learner-written. Admin-approved projects are the trustworthy signal.
-- Rules mirror frontend/src/site/lib/gamification.ts; a test checks the numbers match.

-- ── Reference data ─────────────────────────────────────────────────────────
create table if not exists public.track_topics (
  track text not null,
  note_slug text not null,
  primary key (track, note_slug)
);
create table if not exists public.project_auto_tasks (
  project_slug text not null,
  task_id text not null,
  primary key (project_slug, task_id)
);
create table if not exists public.project_catalog (
  project_slug text primary key,
  auto_tasks int not null,
  manual_tasks int not null
);
create table if not exists public.achievement_definitions (
  id text primary key,
  name text not null,
  description text not null,
  icon text not null,
  xp int not null check (xp >= 0),
  counter text not null,
  target int not null check (target > 0)
);
create table if not exists public.mission_definitions (
  id text primary key,
  period text not null check (period in ('day', 'week')),
  label text not null,
  kind text not null,
  target int not null check (target > 0),
  xp int not null check (xp >= 0)
);

-- ── Ledger ────────────────────────────────────────────────────────────────
create table if not exists public.xp_events (
  id bigserial primary key,
  user_id uuid not null references auth.users (id) on delete cascade,
  source_key text not null,
  kind text not null,
  xp int not null check (xp >= 0),
  created_at timestamptz not null default now(),
  unique (user_id, source_key)
);
create index if not exists xp_events_user_time_idx on public.xp_events (user_id, created_at);
create index if not exists xp_events_time_idx on public.xp_events (created_at);

create table if not exists public.user_achievements (
  user_id uuid not null references auth.users (id) on delete cascade,
  achievement_id text not null references public.achievement_definitions (id),
  unlocked_at timestamptz not null,
  primary key (user_id, achievement_id)
);

alter table public.track_topics enable row level security;
alter table public.project_auto_tasks enable row level security;
alter table public.project_catalog enable row level security;
alter table public.achievement_definitions enable row level security;
alter table public.mission_definitions enable row level security;
alter table public.xp_events enable row level security;
alter table public.user_achievements enable row level security;

do $$
declare t text;
begin
  foreach t in array array['track_topics', 'project_auto_tasks', 'project_catalog', 'achievement_definitions', 'mission_definitions'] loop
    execute format('drop policy if exists %I on public.%I', t || '_read', t);
    execute format('create policy %I on public.%I for select using (true)', t || '_read', t);
  end loop;
end $$;
drop policy if exists xp_events_read on public.xp_events;
create policy xp_events_read on public.xp_events for select using (user_id = auth.uid() or public.is_admin());
drop policy if exists user_achievements_read on public.user_achievements;
create policy user_achievements_read on public.user_achievements for select using (user_id = auth.uid() or public.is_admin());

-- ── Definitions (same numbers as gamification.ts) ─────────────────────────
insert into public.achievement_definitions (id, name, description, icon, xp, counter, target) values
  ('first-query', 'First SQL Query', 'Solve your first SQL question.', 'Terminal', 10, 'sql', 1),
  ('sql-beginner', 'SQL Beginner', 'Solve 5 SQL questions.', 'Database', 25, 'sql', 5),
  ('sql-10', '10 Questions Solved', 'Solve 10 SQL questions.', 'ListChecks', 50, 'sql', 10),
  ('sql-50', '50 Questions Solved', 'Solve 50 SQL questions.', 'Trophy', 150, 'sql', 50),
  ('python-explorer', 'Python Explorer', 'Pass your first Python exercise.', 'FileCode2', 25, 'python', 1),
  ('python-solver', 'Python Problem Solver', 'Pass 10 Python exercises.', 'Code2', 100, 'python', 10),
  ('first-project', 'First Project Completed', 'Complete a project in the Projects lab.', 'FolderCheck', 100, 'project', 1),
  ('streak-7', '7-Day Streak', 'Learn on 7 days in a row.', 'Flame', 50, 'longestStreak', 7),
  ('streak-30', '30-Day Streak', 'Learn on 30 days in a row.', 'Flame', 200, 'longestStreak', 30),
  ('de-explorer', 'Data Engineering Explorer', 'Read 10 data engineering topics.', 'Workflow', 50, 'deNotes', 10),
  ('mock-pass', 'Interview Ready', 'Pass a timed mock interview (60% or more solved).', 'Timer', 50, 'mockPassed', 1),
  ('track-done', 'Track Finisher', 'Read every topic in a data engineering track.', 'Medal', 75, 'track', 1)
on conflict (id) do update set name = excluded.name, description = excluded.description, icon = excluded.icon, xp = excluded.xp, counter = excluded.counter, target = excluded.target;

insert into public.mission_definitions (id, period, label, kind, target, xp) values
  ('sql3', 'day', 'Solve 3 SQL questions', 'sql', 3, 30),
  ('py2', 'day', 'Pass 2 Python exercises', 'python', 2, 20),
  ('note1', 'day', 'Finish 1 learning note', 'note', 1, 10),
  ('cards5', 'day', 'Review 5 flashcards', 'card', 5, 10),
  ('task1', 'day', 'Pass 1 project task', 'task', 1, 15),
  ('w-sql10', 'week', 'Solve 10 SQL questions', 'sql', 10, 60),
  ('w-days4', 'week', 'Learn on 4 different days', 'activeDay', 4, 40),
  ('w-mock1', 'week', 'Finish a mock interview', 'mock', 1, 40)
on conflict (id) do update set period = excluded.period, label = excluded.label, kind = excluded.kind, target = excluded.target, xp = excluded.xp;

-- Generated from frontend/src/site/content (tracks.json and projects/*.md); a test checks it matches.
insert into public.track_topics (track, note_slug) values
  ('python', 'python-fundamentals'),
  ('python', 'python-variables-data-types'),
  ('python', 'python-collections'),
  ('python', 'python-conditionals'),
  ('python', 'python-loops'),
  ('python', 'python-functions'),
  ('python', 'python-lambdas'),
  ('python', 'python-comprehensions'),
  ('python', 'python-oop'),
  ('python', 'python-exceptions'),
  ('python', 'python-file-handling'),
  ('python', 'python-csv-json'),
  ('python', 'python-regex'),
  ('python', 'python-modules-packages'),
  ('python', 'python-virtual-environments'),
  ('python', 'python-logging'),
  ('python', 'python-pandas'),
  ('python', 'python-numpy'),
  ('python', 'python-database-connectivity'),
  ('python', 'python-api-integration'),
  ('python', 'python-etl-pipelines'),
  ('etl', 'etl-architecture'),
  ('etl', 'elt-architecture'),
  ('etl', 'etl-extraction'),
  ('etl', 'etl-transformation'),
  ('etl', 'etl-loading'),
  ('etl', 'etl-full-load'),
  ('etl', 'etl-incremental-load'),
  ('etl', 'etl-change-data-capture'),
  ('etl', 'etl-batch-processing'),
  ('etl', 'etl-streaming-fundamentals'),
  ('etl', 'etl-data-validation'),
  ('etl', 'etl-error-handling'),
  ('etl', 'etl-retries'),
  ('etl', 'etl-idempotency'),
  ('etl', 'etl-pipeline-monitoring'),
  ('warehousing', 'dwh-oltp-vs-olap'),
  ('warehousing', 'dwh-architecture'),
  ('warehousing', 'dwh-fact-tables'),
  ('warehousing', 'dwh-dimension-tables'),
  ('warehousing', 'dwh-star-schema'),
  ('warehousing', 'dwh-snowflake-schema'),
  ('warehousing', 'dwh-slowly-changing-dimensions'),
  ('warehousing', 'dwh-surrogate-keys'),
  ('warehousing', 'dwh-natural-keys'),
  ('warehousing', 'dwh-data-modelling'),
  ('warehousing', 'dwh-data-marts'),
  ('warehousing', 'dwh-partitioning'),
  ('warehousing', 'dwh-historical-data'),
  ('spark', 'spark-distributed-computing'),
  ('spark', 'spark-architecture'),
  ('spark', 'spark-driver-executors'),
  ('spark', 'spark-rdd'),
  ('spark', 'spark-dataframes'),
  ('spark', 'spark-transformations'),
  ('spark', 'spark-actions'),
  ('spark', 'spark-lazy-evaluation'),
  ('spark', 'spark-sql'),
  ('spark', 'spark-joins'),
  ('spark', 'spark-aggregations'),
  ('spark', 'spark-partitioning'),
  ('spark', 'spark-shuffling'),
  ('spark', 'spark-caching'),
  ('spark', 'spark-performance'),
  ('airflow', 'airflow-architecture'),
  ('airflow', 'airflow-dags'),
  ('airflow', 'airflow-tasks'),
  ('airflow', 'airflow-operators'),
  ('airflow', 'airflow-sensors'),
  ('airflow', 'airflow-dependencies'),
  ('airflow', 'airflow-scheduling'),
  ('airflow', 'airflow-xcom'),
  ('airflow', 'airflow-retries'),
  ('airflow', 'airflow-failure-handling'),
  ('airflow', 'airflow-connections'),
  ('airflow', 'airflow-variables'),
  ('airflow', 'airflow-backfilling'),
  ('airflow', 'airflow-monitoring'),
  ('dbt', 'dbt-fundamentals'),
  ('dbt', 'dbt-models'),
  ('dbt', 'dbt-sources'),
  ('dbt', 'dbt-seeds'),
  ('dbt', 'dbt-tests'),
  ('dbt', 'dbt-snapshots'),
  ('dbt', 'dbt-macros'),
  ('dbt', 'dbt-jinja'),
  ('dbt', 'dbt-incremental-models'),
  ('dbt', 'dbt-documentation'),
  ('dbt', 'dbt-deployment'),
  ('cloud', 'cloud-aws-overview'),
  ('cloud', 'cloud-azure-overview'),
  ('cloud', 'cloud-gcp-overview'),
  ('cloud', 'cloud-object-storage'),
  ('cloud', 'cloud-data-lakes'),
  ('cloud', 'cloud-data-warehouses'),
  ('cloud', 'cloud-compute'),
  ('cloud', 'cloud-orchestration'),
  ('cloud', 'cloud-security'),
  ('cloud', 'cloud-iam'),
  ('cloud', 'cloud-networking'),
  ('cloud', 'cloud-monitoring'),
  ('cloud', 'cloud-cost-management')
on conflict do nothing;

insert into public.project_auto_tasks (project_slug, task_id) values
  ('airflow-etl-pipeline', 'dag-topology'),
  ('airflow-etl-pipeline', 'data-intervals'),
  ('airflow-etl-pipeline', 'retry-delays'),
  ('airflow-etl-pipeline', 'idempotent-partition'),
  ('airflow-etl-pipeline', 'backfill-month'),
  ('csv-to-postgres-etl', 'parse-csv'),
  ('csv-to-postgres-etl', 'parameterised-insert'),
  ('csv-to-postgres-etl', 'stage-orders'),
  ('csv-to-postgres-etl', 'dedupe-orders'),
  ('csv-to-postgres-etl', 'idempotent-load'),
  ('data-validation-pipeline', 'dq-results'),
  ('data-validation-pipeline', 'quarantine'),
  ('data-validation-pipeline', 'stock-recon'),
  ('data-validation-pipeline', 'rule-engine'),
  ('data-validation-pipeline', 'schema-validator'),
  ('dbt-analytics-project', 'staging-models'),
  ('dbt-analytics-project', 'fct-orders'),
  ('dbt-analytics-project', 'compiled-tests'),
  ('dbt-analytics-project', 'check-snapshot'),
  ('dbt-analytics-project', 'ref-graph'),
  ('end-to-end-pipeline', 'validate-extract'),
  ('end-to-end-pipeline', 'bronze-silver'),
  ('end-to-end-pipeline', 'gold-mart'),
  ('end-to-end-pipeline', 'reconciliation'),
  ('end-to-end-pipeline', 'run-log'),
  ('hr-analytics-warehouse', 'dim-department'),
  ('hr-analytics-warehouse', 'dim-employee'),
  ('hr-analytics-warehouse', 'fact-salary-change'),
  ('hr-analytics-warehouse', 'mart-headcount'),
  ('hr-analytics-warehouse', 'attrition-rate'),
  ('incremental-loading', 'initial-load'),
  ('incremental-loading', 'incremental-run'),
  ('incremental-loading', 'upsert-corrections'),
  ('incremental-loading', 'idempotency'),
  ('incremental-loading', 'lookback-window'),
  ('pyspark-transformation', 'groupby-agg'),
  ('pyspark-transformation', 'window-functions'),
  ('pyspark-transformation', 'partition-skew'),
  ('pyspark-transformation', 'spark-sql-ltv'),
  ('python-data-cleaning', 'clean-columns'),
  ('python-data-cleaning', 'dedupe-people'),
  ('python-data-cleaning', 'null-report'),
  ('python-data-cleaning', 'sql-employees-clean'),
  ('python-data-cleaning', 'sql-dq-summary'),
  ('rest-api-to-postgres', 'paginate'),
  ('rest-api-to-postgres', 'retry-backoff'),
  ('rest-api-to-postgres', 'flatten-json'),
  ('rest-api-to-postgres', 'land-raw-json'),
  ('rest-api-to-postgres', 'parse-jsonb'),
  ('rest-api-to-postgres', 'upsert-orders'),
  ('sales-analytics-pipeline', 'fact-order-lines'),
  ('sales-analytics-pipeline', 'monthly-revenue'),
  ('sales-analytics-pipeline', 'rep-attainment'),
  ('sales-analytics-pipeline', 'top-products-region'),
  ('sales-analytics-pipeline', 'mom-growth'),
  ('star-schema-warehouse', 'dim-date'),
  ('star-schema-warehouse', 'dim-product'),
  ('star-schema-warehouse', 'dim-customer-initial'),
  ('star-schema-warehouse', 'scd2-change'),
  ('star-schema-warehouse', 'fact-sales'),
  ('star-schema-warehouse', 'grain-validator')
on conflict do nothing;

insert into public.project_catalog (project_slug, auto_tasks, manual_tasks) values
  ('airflow-etl-pipeline', 5, 1),
  ('csv-to-postgres-etl', 5, 1),
  ('data-validation-pipeline', 5, 0),
  ('dbt-analytics-project', 5, 1),
  ('end-to-end-pipeline', 5, 1),
  ('hr-analytics-warehouse', 5, 0),
  ('incremental-loading', 5, 0),
  ('pyspark-transformation', 4, 1),
  ('python-data-cleaning', 5, 0),
  ('rest-api-to-postgres', 6, 1),
  ('sales-analytics-pipeline', 5, 1),
  ('star-schema-warehouse', 6, 0)
on conflict (project_slug) do update set auto_tasks = excluded.auto_tasks, manual_tasks = excluded.manual_tasks;

-- ── Award engine ──────────────────────────────────────────────────────────
-- Client-supplied timestamps (lesson/read dates in profile state) are parsed defensively and never
-- allowed to be in the future.
create or replace function public.gm_ts(v text) returns timestamptz
language plpgsql stable as $$
begin
  return least(v::timestamptz, now());
exception when others then
  return now();
end $$;

create or replace function public.gm_day(t timestamptz) returns date
language sql immutable as $$ select (t at time zone 'UTC')::date $$;

-- Achievements and missions are checked after every new base award.
create or replace function public.gm_evaluate(uid uuid, at timestamptz) returns void
language plpgsql security definer set search_path = public as $$
declare
  c jsonb;
  a record;
  m record;
  d date := gm_day(at);
  ws date := date_trunc('week', gm_day(at))::date;
  n int;
begin
  select jsonb_build_object(
    'sql', count(*) filter (where kind = 'sql'),
    'python', count(*) filter (where kind = 'python'),
    'lesson', count(*) filter (where kind = 'lesson'),
    'scenario', count(*) filter (where kind = 'scenario'),
    'note', count(*) filter (where kind = 'note'),
    'card', count(*) filter (where kind = 'card'),
    'task', count(*) filter (where kind = 'task'),
    'project', count(*) filter (where kind = 'project'),
    'mock', count(*) filter (where kind = 'mock'),
    'mockPassed', count(*) filter (where kind = 'mock' and xp = 30),
    'track', count(*) filter (where kind = 'track'),
    'deNotes', count(*) filter (where kind = 'note' and exists (select 1 from track_topics t where t.note_slug = substr(source_key, 6))),
    'longestStreak', coalesce((
      select max(cnt) from (
        select count(*) cnt from (
          select dd, dd - (row_number() over (order by dd))::int as grp
          from (select distinct gm_day(e2.created_at) dd from xp_events e2 where e2.user_id = uid and e2.kind not in ('achievement', 'mission', 'day')) s
        ) g group by grp
      ) x), 0))
  into c from xp_events where user_id = uid and kind not in ('achievement', 'mission', 'day');

  for a in select * from achievement_definitions loop
    if coalesce((c ->> a.counter)::int, 0) >= a.target then
      insert into user_achievements (user_id, achievement_id, unlocked_at) values (uid, a.id, at) on conflict do nothing;
      perform award_xp(uid, 'achievement:' || a.id, 'achievement', a.xp, at);
    end if;
  end loop;

  for m in select * from mission_definitions loop
    if m.kind = 'activeDay' then
      select count(distinct gm_day(created_at)) into n from xp_events
        where user_id = uid and kind not in ('achievement', 'mission', 'day')
          and gm_day(created_at) between (case when m.period = 'day' then d else ws end) and (case when m.period = 'day' then d else ws + 6 end);
    else
      select count(*) into n from xp_events
        where user_id = uid and kind = m.kind
          and gm_day(created_at) between (case when m.period = 'day' then d else ws end) and (case when m.period = 'day' then d else ws + 6 end);
    end if;
    if n >= m.target then
      perform award_xp(uid, 'mission:' || m.id || ':' || (case when m.period = 'day' then d else ws end), 'mission', m.xp, at);
    end if;
  end loop;
end $$;

-- Insert one award; duplicates (same user + source_key) are ignored. Base awards also grant the
-- daily-activity bonus once per UTC day and re-check achievements and missions.
create or replace function public.award_xp(uid uuid, key text, k text, amount int, at timestamptz) returns boolean
language plpgsql security definer set search_path = public as $$
declare
  ok boolean;
  t timestamptz := least(coalesce(at, now()), now());
begin
  insert into xp_events (user_id, source_key, kind, xp, created_at) values (uid, key, k, greatest(amount, 0), t)
    on conflict (user_id, source_key) do nothing
    returning true into ok;
  if ok is null then return false; end if;
  if k not in ('achievement', 'mission', 'day') then
    perform award_xp(uid, 'day:' || gm_day(t), 'day', 5, (gm_day(t)::timestamp at time zone 'UTC'));
    perform gm_evaluate(uid, t);
  end if;
  return true;
end $$;

-- SQL XP needs a solved progress row and a practised (not imported) flag in profile state;
-- whichever arrives second triggers the award.
create or replace function public.gm_sql(uid uuid, q int) returns void
language plpgsql security definer set search_path = public as $$
declare
  r record;
  meta jsonb;
begin
  select solved_at, revealed into r from progress where user_id = uid and question_number = q;
  if r.solved_at is null then return; end if;
  select state -> 'qmeta' -> (q::text) into meta from profiles where id = uid;
  if coalesce((meta ->> 'practiced')::boolean, false) and not coalesce((meta ->> 'imported')::boolean, false) then
    perform award_xp(uid, 'sql:' || q, 'sql', case when r.revealed then 10 else 20 end, r.solved_at);
  end if;
end $$;

-- New lessons, notes, practised solves and flashcard reviews in profile state (keys not in `prev`).
create or replace function public.gm_state(uid uuid, cur jsonb, prev jsonb) returns void
language plpgsql security definer set search_path = public as $$
declare
  kv record;
  el text;
  tr record;
  n int;
begin
  for kv in select key, value from jsonb_each(coalesce(cur -> 'qmeta', '{}'::jsonb)) loop
    if (kv.value ->> 'practiced')::boolean is true and not (coalesce(prev -> 'qmeta' -> kv.key ->> 'practiced', 'false'))::boolean then
      perform gm_sql(uid, kv.key::int);
    end if;
  end loop;

  for kv in select key, value from jsonb_each_text(coalesce(cur -> 'lessons', '{}'::jsonb)) loop
    continue when coalesce(prev -> 'lessons', '{}'::jsonb) ? kv.key;
    if kv.key like 'py:%' then perform award_xp(uid, kv.key, 'python', 15, gm_ts(kv.value));
    elsif kv.key like 'scenario:%' then perform award_xp(uid, kv.key, 'scenario', 15, gm_ts(kv.value));
    elsif kv.key like '%#%' then perform award_xp(uid, 'lesson:' || kv.key, 'lesson', 10, gm_ts(kv.value));
    end if;
  end loop;

  for kv in select key, value from jsonb_each_text(coalesce(cur -> 'read', '{}'::jsonb)) loop
    continue when coalesce(prev -> 'read', '{}'::jsonb) ? kv.key;
    perform award_xp(uid, 'note:' || kv.key, 'note', 5, gm_ts(kv.value));
    for tr in select track from track_topics where note_slug = kv.key loop
      if not exists (select 1 from track_topics t where t.track = tr.track and not (coalesce(cur -> 'read', '{}'::jsonb) ? t.note_slug)) then
        perform award_xp(uid, 'track:' || tr.track, 'track', 50, gm_ts(kv.value));
      end if;
    end loop;
  end loop;

  for kv in select key, value from jsonb_each(coalesce(cur -> 'reviews', '{}'::jsonb)) loop
    continue when jsonb_typeof(kv.value) <> 'array';
    for el in select distinct x from jsonb_array_elements_text(kv.value) as x loop
      select count(*) into n from xp_events where user_id = uid and kind = 'card' and source_key like 'card:%:' || kv.key;
      exit when n >= 20;
      perform award_xp(uid, 'card:' || el || ':' || kv.key, 'card', 2, gm_ts(kv.key || 'T12:00:00Z'));
    end loop;
  end loop;
end $$;

create or replace function public.gm_task(uid uuid, slug text, task text, at timestamptz) returns void
language plpgsql security definer set search_path = public as $$
declare cat record;
begin
  if not exists (select 1 from project_auto_tasks where project_slug = slug and task_id = task) then return; end if;
  perform award_xp(uid, 'task:' || slug || ':' || task, 'task', 10, at);
  select * into cat from project_catalog where project_slug = slug;
  -- Projects with manual steps complete only when an admin approves the submission.
  if cat.manual_tasks = 0 and (
    select count(*) from project_progress p join project_auto_tasks a on a.project_slug = p.project_slug and a.task_id = p.task_id
    where p.user_id = uid and p.project_slug = slug and p.passed) >= cat.auto_tasks then
    perform award_xp(uid, 'project:' || slug, 'project', 100, at);
  end if;
end $$;

-- ── Triggers ──────────────────────────────────────────────────────────────
create or replace function public.gm_on_progress() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.solved_at is not null and (tg_op = 'INSERT' or old.solved_at is null) then
    perform gm_sql(new.user_id, new.question_number);
  end if;
  return new;
end $$;
drop trigger if exists gm_progress on public.progress;
create trigger gm_progress after insert or update on public.progress for each row execute function public.gm_on_progress();

create or replace function public.gm_on_profile() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.state is distinct from old.state then
    perform gm_state(new.id, coalesce(new.state, '{}'::jsonb), coalesce(old.state, '{}'::jsonb));
  end if;
  return new;
end $$;
drop trigger if exists gm_profile on public.profiles;
create trigger gm_profile after update of state on public.profiles for each row execute function public.gm_on_profile();

create or replace function public.gm_on_mock() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  perform award_xp(new.user_id, 'mock:' || new.id, 'mock', case when new.total > 0 and new.solved::numeric / new.total >= 0.6 then 30 else 10 end, new.created_at);
  return new;
end $$;
drop trigger if exists gm_mock on public.mock_sessions;
create trigger gm_mock after insert on public.mock_sessions for each row execute function public.gm_on_mock();

create or replace function public.gm_on_task() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.passed and (tg_op = 'INSERT' or not old.passed) then
    perform gm_task(new.user_id, new.project_slug, new.task_id, new.updated_at);
  end if;
  return new;
end $$;
drop trigger if exists gm_task on public.project_progress;
create trigger gm_task after insert or update on public.project_progress for each row execute function public.gm_on_task();

create or replace function public.gm_on_submission() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.status = 'Completed' and old.status is distinct from 'Completed' then
    perform award_xp(new.user_id, 'project:' || new.project_slug, 'project', 100, coalesce(new.reviewed_at, now()));
  end if;
  return new;
end $$;
drop trigger if exists gm_submission on public.project_submissions;
create trigger gm_submission after update on public.project_submissions for each row execute function public.gm_on_submission();

-- ── Read APIs ─────────────────────────────────────────────────────────────
-- XP leaderboard: only users who opted into a public profile; usernames only, never emails.
create or replace function public.xp_leaderboard(period text default 'week') returns table (username text, xp bigint)
language sql stable security definer set search_path = public as $$
  select p.username::text, sum(e.xp)::bigint
  from xp_events e join profiles p on p.id = e.user_id
  where p.public_profile
    and e.created_at >= case period when 'week' then date_trunc('week', now()) when 'month' then date_trunc('month', now()) else '-infinity'::timestamptz end
  group by p.username
  order by 2 desc, 1
  limit 50;
$$;

-- The caller's totals and rank. Rank is among public profiles and only shown if the caller is public.
create or replace function public.my_xp() returns jsonb
language sql stable security definer set search_path = public as $$
  with me as (select id, public_profile from profiles where id = auth.uid()),
  totals as (
    select e.user_id,
      sum(e.xp) as total,
      sum(e.xp) filter (where e.created_at >= date_trunc('week', now())) as week,
      sum(e.xp) filter (where e.created_at >= date_trunc('month', now())) as month
    from xp_events e join profiles p on p.id = e.user_id
    where p.public_profile or e.user_id = auth.uid()
    group by e.user_id
  )
  select jsonb_build_object(
    'total', coalesce((select total from totals where user_id = auth.uid()), 0),
    'week', coalesce((select week from totals where user_id = auth.uid()), 0),
    'month', coalesce((select month from totals where user_id = auth.uid()), 0),
    'public', coalesce((select public_profile from me), false),
    'weekRank', case when (select public_profile from me) then
      (select 1 + count(*) from totals t join profiles p on p.id = t.user_id
        where p.public_profile and coalesce(t.week, 0) > coalesce((select week from totals where user_id = auth.uid()), 0)) end)
  where auth.uid() is not null;
$$;

-- ── Permissions ───────────────────────────────────────────────────────────
-- Award functions run only from triggers (as their owner). Clients may not call them.
revoke all on function public.award_xp(uuid, text, text, int, timestamptz) from public, anon, authenticated;
revoke all on function public.gm_evaluate(uuid, timestamptz) from public, anon, authenticated;
revoke all on function public.gm_sql(uuid, int) from public, anon, authenticated;
revoke all on function public.gm_state(uuid, jsonb, jsonb) from public, anon, authenticated;
revoke all on function public.gm_task(uuid, text, text, timestamptz) from public, anon, authenticated;
grant execute on function public.xp_leaderboard(text) to anon, authenticated;
grant execute on function public.my_xp() to authenticated;

-- ── Backfill existing records (idempotent: re-running awards nothing new) ──
do $$
declare
  u record;
  r record;
begin
  for u in select id, state from profiles loop
    perform public.gm_state(u.id, coalesce(u.state, '{}'::jsonb), '{}'::jsonb);
  end loop;
  for r in select user_id, question_number from progress where solved_at is not null loop
    perform public.gm_sql(r.user_id, r.question_number);
  end loop;
  for r in select * from mock_sessions loop
    perform public.award_xp(r.user_id, 'mock:' || r.id, 'mock', case when r.total > 0 and r.solved::numeric / r.total >= 0.6 then 30 else 10 end, r.created_at);
  end loop;
  for r in select * from project_progress where passed loop
    perform public.gm_task(r.user_id, r.project_slug, r.task_id, r.updated_at);
  end loop;
  for r in select * from project_submissions where status = 'Completed' loop
    perform public.award_xp(r.user_id, 'project:' || r.project_slug, 'project', 100, coalesce(r.reviewed_at, r.created_at));
  end loop;
end $$;
