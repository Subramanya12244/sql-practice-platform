-- DataForge Phase 3: visualization sessions, project progress/submissions, data quality rules and runs.
-- Apply after 002_community.sql. Safe to re-run. Every table is owned per user (RLS), admins can read.

create table if not exists public.query_visualization_sessions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  question_key text not null,              -- "q25" for questions, "s:<slug>" for scenarios
  attempt int not null default 0,          -- attempts at the time; earlier sessions are never overwritten
  dataset text not null default 'northwind',
  executed_sql text not null check (length(executed_sql) <= 20000),
  structure text,                          -- parsed summary, e.g. "SELECT · 2 join(s)"
  stages text[] not null default '{}',
  plan_root text,
  plan_cost numeric,
  volatile text[],
  created_at timestamptz not null default now()
);
create index if not exists qvs_user_q_idx on public.query_visualization_sessions (user_id, question_key, created_at desc);

create table if not exists public.project_progress (
  user_id uuid not null references auth.users (id) on delete cascade,
  project_slug text not null,
  task_id text not null,
  passed boolean not null default false,  -- set only from an automated check result
  code text check (length(code) <= 50000),
  message text,
  updated_at timestamptz not null default now(),
  primary key (user_id, project_slug, task_id)
);

create table if not exists public.project_submissions (
  id bigserial primary key,
  user_id uuid not null references auth.users (id) on delete cascade,
  project_slug text not null,
  repo_url text check (repo_url is null or repo_url ~ '^https://(github\.com|gitlab\.com|bitbucket\.org)/[^/]+/[^/]+'),
  notes text check (length(notes) <= 2000),
  checklist jsonb not null default '{}'::jsonb,
  status text not null default 'Submitted' check (status in ('Submitted', 'Under evaluation', 'Completed', 'Changes requested')),
  reviewed_by uuid references auth.users (id),
  reviewed_at timestamptz,
  created_at timestamptz not null default now()
);

create table if not exists public.data_quality_rules (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  dataset text not null,
  rule jsonb not null,
  created_at timestamptz not null default now()
);

create table if not exists public.data_quality_runs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  dataset text not null,
  score int check (score between 0 and 100),
  results jsonb not null,                  -- per-rule checked/failed/status/message (no sample rows)
  created_at timestamptz not null default now()
);
create index if not exists dqr_user_ds_idx on public.data_quality_runs (user_id, dataset, created_at desc);

alter table public.query_visualization_sessions enable row level security;
alter table public.project_progress enable row level security;
alter table public.project_submissions enable row level security;
alter table public.data_quality_rules enable row level security;
alter table public.data_quality_runs enable row level security;

do $$
declare t text;
begin
  foreach t in array array['query_visualization_sessions', 'project_progress', 'data_quality_rules', 'data_quality_runs'] loop
    execute format('drop policy if exists %I on public.%I', t || '_own', t);
    execute format('create policy %I on public.%I for all using (user_id = auth.uid()) with check (user_id = auth.uid())', t || '_own', t);
    execute format('drop policy if exists %I on public.%I', t || '_admin_read', t);
    execute format('create policy %I on public.%I for select using (public.is_admin())', t || '_admin_read', t);
  end loop;
end $$;

-- Submissions: users create and read their own; only admins review (set status/reviewer).
drop policy if exists submissions_read on public.project_submissions;
create policy submissions_read on public.project_submissions for select using (user_id = auth.uid() or public.is_admin());
drop policy if exists submissions_insert on public.project_submissions;
create policy submissions_insert on public.project_submissions for insert
  with check (user_id = auth.uid() and status = 'Submitted' and reviewed_by is null);
drop policy if exists submissions_review on public.project_submissions;
create policy submissions_review on public.project_submissions for update using (public.is_admin());
