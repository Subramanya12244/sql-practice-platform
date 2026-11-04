-- Review schedule sync, public profiles, shared solutions, comments, weekly challenge, leaderboard.
-- Apply after 001_accounts.sql. Safe to re-run.

alter table public.progress add column if not exists review_box int;
alter table public.progress add column if not exists review_due date;
alter table public.profiles add column if not exists public_profile boolean not null default false;

alter table public.audit_log drop constraint if exists audit_log_action_check;
alter table public.audit_log add constraint audit_log_action_check check (action in
  ('signup', 'login', 'logout', 'submit', 'solve', 'mock_finish', 'password_change', 'role_change', 'progress_import',
   'solution_share', 'comment', 'comment_hide'));

-- ── Shared solutions ─────────────────────────────────────────────────────
create table if not exists public.solutions (
  id bigserial primary key,
  user_id uuid not null references auth.users (id) on delete cascade,
  question_number int not null,
  sql text not null check (length(sql) between 1 and 8000),
  note text check (length(note) <= 500),
  hidden boolean not null default false,
  created_at timestamptz not null default now(),
  unique (user_id, question_number)
);
create index if not exists solutions_q_idx on public.solutions (question_number);

create table if not exists public.solution_likes (
  solution_id bigint not null references public.solutions (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  primary key (solution_id, user_id)
);

-- ── Comments ─────────────────────────────────────────────────────────────
create table if not exists public.comments (
  id bigserial primary key,
  question_number int not null,
  user_id uuid not null references auth.users (id) on delete cascade,
  body text not null check (length(btrim(body)) between 1 and 2000),
  hidden boolean not null default false,
  created_at timestamptz not null default now()
);
create index if not exists comments_q_idx on public.comments (question_number, created_at);

-- ── Weekly challenge ─────────────────────────────────────────────────────
create table if not exists public.weekly_challenges (
  week date primary key check (extract(isodow from week) = 1),  -- Monday
  question_numbers int[] not null check (cardinality(question_numbers) between 1 and 5)
);

-- ── Helpers ──────────────────────────────────────────────────────────────
-- Only users who solved a question may see and post its solutions (no spoilers).
create or replace function public.has_solved(q int) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from progress where user_id = auth.uid() and question_number = q and solved_at is not null);
$$;

-- At most 20 comments per user per hour.
create or replace function public.comment_rate_ok() returns boolean
language sql stable security definer set search_path = public as $$
  select count(*) < 20 from comments where user_id = auth.uid() and created_at > now() - interval '1 hour';
$$;

-- ── RLS ──────────────────────────────────────────────────────────────────
alter table public.solutions enable row level security;
alter table public.solution_likes enable row level security;
alter table public.comments enable row level security;
alter table public.weekly_challenges enable row level security;

drop policy if exists solutions_read on public.solutions;
create policy solutions_read on public.solutions for select
  using (user_id = auth.uid() or public.is_admin() or (not hidden and public.has_solved(question_number)));
drop policy if exists solutions_write on public.solutions;
create policy solutions_write on public.solutions for insert
  with check (user_id = auth.uid() and public.has_solved(question_number) and not hidden);
drop policy if exists solutions_update on public.solutions;
create policy solutions_update on public.solutions for update
  using (user_id = auth.uid() or public.is_admin());
drop policy if exists solutions_delete on public.solutions;
create policy solutions_delete on public.solutions for delete using (user_id = auth.uid());

drop policy if exists likes_read on public.solution_likes;
create policy likes_read on public.solution_likes for select using (true);
drop policy if exists likes_write on public.solution_likes;
create policy likes_write on public.solution_likes for insert with check (user_id = auth.uid());
drop policy if exists likes_delete on public.solution_likes;
create policy likes_delete on public.solution_likes for delete using (user_id = auth.uid());

drop policy if exists comments_read on public.comments;
create policy comments_read on public.comments for select using (not hidden or user_id = auth.uid() or public.is_admin());
drop policy if exists comments_write on public.comments;
create policy comments_write on public.comments for insert
  with check (user_id = auth.uid() and not hidden and public.comment_rate_ok());
drop policy if exists comments_update on public.comments;
create policy comments_update on public.comments for update using (public.is_admin());
drop policy if exists comments_delete on public.comments;
create policy comments_delete on public.comments for delete using (user_id = auth.uid());

drop policy if exists challenges_read on public.weekly_challenges;
create policy challenges_read on public.weekly_challenges for select using (true);
drop policy if exists challenges_admin on public.weekly_challenges;
create policy challenges_admin on public.weekly_challenges for all using (public.is_admin()) with check (public.is_admin());

-- Hiding content is an admin action worth auditing. Users may not un-hide their own rows.
create or replace function public.guard_hidden() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.hidden is distinct from old.hidden then
    if auth.uid() is not null and not is_admin() then
      raise exception 'only admins can hide or unhide';
    end if;
    insert into audit_log (user_id, action, detail)
      values (auth.uid(), 'comment_hide', jsonb_build_object('table', tg_table_name, 'id', new.id, 'hidden', new.hidden));
  end if;
  return new;
end $$;
drop trigger if exists comments_hidden_guard on public.comments;
create trigger comments_hidden_guard before update on public.comments for each row execute function public.guard_hidden();
drop trigger if exists solutions_hidden_guard on public.solutions;
create trigger solutions_hidden_guard before update on public.solutions for each row execute function public.guard_hidden();

-- ── Public read RPCs (expose usernames only, never emails) ───────────────
create or replace function public.question_comments(q int) returns table (
  id bigint, username text, body text, created_at timestamptz, mine boolean, hidden boolean)
language sql stable security definer set search_path = public as $$
  select c.id, p.username::text, c.body, c.created_at, c.user_id = auth.uid(), c.hidden
  from comments c join profiles p on p.id = c.user_id
  where c.question_number = q and (not c.hidden or c.user_id = auth.uid() or is_admin())
  order by c.created_at;
$$;
grant execute on function public.question_comments(int) to anon, authenticated;

create or replace function public.question_solutions(q int) returns table (
  id bigint, username text, sql text, note text, created_at timestamptz, likes bigint, liked boolean, mine boolean)
language plpgsql stable security definer set search_path = public as $$
begin
  if not (has_solved(q) or is_admin()) then return; end if;
  return query
    select s.id, p.username::text, s.sql, s.note, s.created_at,
           (select count(*) from solution_likes l where l.solution_id = s.id),
           exists (select 1 from solution_likes l where l.solution_id = s.id and l.user_id = auth.uid()),
           s.user_id = auth.uid()
    from solutions s join profiles p on p.id = s.user_id
    where s.question_number = q and (not s.hidden or s.user_id = auth.uid())
    order by 6 desc, s.created_at;
end $$;
grant execute on function public.question_solutions(int) to authenticated;

-- Leaderboard: solves in the period. Only users who opted into a public profile appear.
create or replace function public.leaderboard(period text default 'week') returns table (
  username text, solved bigint, last_solve timestamptz)
language sql stable security definer set search_path = public as $$
  select p.username::text, count(*), max(g.solved_at)
  from progress g join profiles p on p.id = g.user_id
  where p.public_profile and g.solved_at is not null
    and g.solved_at > case period when 'week' then date_trunc('week', now())
                                  when 'month' then date_trunc('month', now())
                                  else '-infinity'::timestamptz end
  group by p.username
  order by 2 desc, 3 asc
  limit 50;
$$;
grant execute on function public.leaderboard(text) to anon, authenticated;

create or replace function public.public_profile(u text) returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'username', p.username,
    'joined', p.created_at,
    'solved', (select count(*) from progress g where g.user_id = p.id and g.solved_at is not null),
    'solvedNumbers', (select coalesce(jsonb_agg(g.question_number order by g.question_number), '[]'::jsonb)
                      from progress g where g.user_id = p.id and g.solved_at is not null),
    'activeDays', coalesce(p.state -> 'activeDays', '[]'::jsonb),
    'solutions', (select count(*) from solutions s where s.user_id = p.id and not s.hidden))
  from profiles p where p.username = u::citext and p.public_profile;
$$;
grant execute on function public.public_profile(text) to anon, authenticated;

-- This week's challenge ranking: who solved all of its questions, fastest after Monday 00:00 UTC.
create or replace function public.challenge_ranking() returns table (username text, solved bigint, finished_at timestamptz)
language sql stable security definer set search_path = public as $$
  with w as (select * from weekly_challenges where week = date_trunc('week', now())::date)
  select p.username::text, count(*), max(g.solved_at)
  from w join progress g on g.question_number = any (w.question_numbers) and g.solved_at >= w.week
  join profiles p on p.id = g.user_id and p.public_profile
  group by p.username
  order by 2 desc, 3 asc
  limit 50;
$$;
grant execute on function public.challenge_ranking() to anon, authenticated;
