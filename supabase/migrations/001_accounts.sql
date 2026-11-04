-- Accounts, synced progress, and an audit log for the public site.
-- Apply in the Supabase SQL editor (or `supabase db push`). Safe to re-run.

create extension if not exists citext;

-- ── Profiles ─────────────────────────────────────────────────────────────
create table if not exists public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  username citext unique not null check (username ~ '^[A-Za-z0-9._-]{3,32}$'),
  role text not null default 'user' check (role in ('user', 'admin')),
  must_change_password boolean not null default false,
  -- Flashcard boxes and active days; small, so one JSON blob per user.
  state jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  last_seen_at timestamptz
);

create or replace function public.is_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from profiles where id = auth.uid() and role = 'admin');
$$;

-- New auth user → profile. Username comes from signup metadata, else the email local part.
create or replace function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  base text := regexp_replace(
    coalesce(new.raw_user_meta_data ->> 'username', split_part(new.email, '@', 1)),
    '[^A-Za-z0-9._-]', '', 'g');
  candidate text;
  n int := 0;
begin
  if length(base) < 3 then base := base || 'user'; end if;
  base := left(base, 28);
  candidate := base;
  while exists (select 1 from profiles where username = candidate::citext) loop
    n := n + 1;
    candidate := base || n;
  end loop;
  insert into profiles (id, username) values (new.id, candidate);
  insert into audit_log (user_id, action, detail)
    values (new.id, 'signup', jsonb_build_object('provider', new.raw_app_meta_data ->> 'provider'));
  return new;
end $$;

-- ── Progress ─────────────────────────────────────────────────────────────
create table if not exists public.progress (
  user_id uuid not null references auth.users (id) on delete cascade,
  question_number int not null,
  attempts int not null default 0,
  solved_at timestamptz,
  revealed boolean not null default false,
  updated_at timestamptz not null default now(),
  primary key (user_id, question_number)
);

create table if not exists public.mock_sessions (
  id bigserial primary key,
  user_id uuid not null references auth.users (id) on delete cascade,
  solved int not null,
  total int not null,
  used_sec int not null,
  duration_min int not null,
  created_at timestamptz not null default now()
);

create table if not exists public.audit_log (
  id bigserial primary key,
  user_id uuid references auth.users (id) on delete set null,
  action text not null check (action in
    ('signup', 'login', 'logout', 'submit', 'solve', 'mock_finish', 'password_change', 'role_change', 'progress_import')),
  detail jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index if not exists audit_log_created_idx on public.audit_log (created_at desc);
create index if not exists audit_log_user_idx on public.audit_log (user_id, created_at desc);

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created after insert on auth.users
  for each row execute function public.handle_new_user();

-- ── Row level security ───────────────────────────────────────────────────
alter table public.profiles enable row level security;
alter table public.progress enable row level security;
alter table public.mock_sessions enable row level security;
alter table public.audit_log enable row level security;

drop policy if exists profiles_read on public.profiles;
create policy profiles_read on public.profiles for select using (id = auth.uid() or public.is_admin());
drop policy if exists profiles_update_self on public.profiles;
create policy profiles_update_self on public.profiles for update using (id = auth.uid());

-- Users may not change their own role or username; only admins may change roles.
-- auth.uid() is null for the service role (seed script / dashboard), which is allowed.
create or replace function public.guard_profile_update() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.role is distinct from old.role and auth.uid() is not null and not is_admin() then
    raise exception 'only admins can change roles';
  end if;
  if new.username is distinct from old.username and auth.uid() is not null and not is_admin() then
    raise exception 'username cannot be changed';
  end if;
  if new.role is distinct from old.role then
    insert into audit_log (user_id, action, detail)
      values (auth.uid(), 'role_change', jsonb_build_object('target', new.id, 'from', old.role, 'to', new.role));
  end if;
  return new;
end $$;
drop trigger if exists profiles_guard on public.profiles;
create trigger profiles_guard before update on public.profiles
  for each row execute function public.guard_profile_update();

drop policy if exists profiles_admin_update on public.profiles;
create policy profiles_admin_update on public.profiles for update using (public.is_admin());

drop policy if exists progress_own on public.progress;
create policy progress_own on public.progress for all
  using (user_id = auth.uid()) with check (user_id = auth.uid());
drop policy if exists progress_admin_read on public.progress;
create policy progress_admin_read on public.progress for select using (public.is_admin());

drop policy if exists mocks_own on public.mock_sessions;
create policy mocks_own on public.mock_sessions for all
  using (user_id = auth.uid()) with check (user_id = auth.uid());
drop policy if exists mocks_admin_read on public.mock_sessions;
create policy mocks_admin_read on public.mock_sessions for select using (public.is_admin());

-- Audit log is append-only for users; no update/delete policies exist.
drop policy if exists audit_insert_own on public.audit_log;
create policy audit_insert_own on public.audit_log for insert
  with check (user_id = auth.uid() and action not in ('signup', 'role_change'));
drop policy if exists audit_read on public.audit_log;
create policy audit_read on public.audit_log for select using (user_id = auth.uid() or public.is_admin());

-- ── RPCs ─────────────────────────────────────────────────────────────────
-- Lets the login form accept a username. Returns only the email, nothing else.
create or replace function public.email_for_username(u text) returns text
language sql stable security definer set search_path = public, auth as $$
  select au.email from profiles p join auth.users au on au.id = p.id where p.username = u::citext;
$$;
grant execute on function public.email_for_username(text) to anon, authenticated;

create or replace function public.touch_last_seen() returns void
language sql security definer set search_path = public as $$
  update profiles set last_seen_at = now() where id = auth.uid();
$$;
grant execute on function public.touch_last_seen() to authenticated;

create or replace function public.admin_stats() returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  if not is_admin() then raise exception 'forbidden'; end if;
  return jsonb_build_object(
    'users', (select count(*) from profiles),
    'admins', (select count(*) from profiles where role = 'admin'),
    'active7', (select count(*) from profiles where last_seen_at > now() - interval '7 days'),
    'active30', (select count(*) from profiles where last_seen_at > now() - interval '30 days'),
    'solves', (select count(*) from progress where solved_at is not null),
    'mocks', (select count(*) from mock_sessions),
    'signupsByDay', (
      select coalesce(jsonb_agg(jsonb_build_object('day', d, 'n', n) order by d), '[]'::jsonb)
      from (select created_at::date d, count(*) n from profiles
            where created_at > now() - interval '30 days' group by 1) s)
  );
end $$;
grant execute on function public.admin_stats() to authenticated;

-- One row per user with solved counts, for the admin users table.
create or replace function public.admin_users() returns table (
  id uuid, username text, role text, created_at timestamptz, last_seen_at timestamptz,
  solved bigint, attempts bigint, mocks bigint)
language plpgsql stable security definer set search_path = public as $$
begin
  if not is_admin() then raise exception 'forbidden'; end if;
  return query
    select p.id, p.username::text, p.role, p.created_at, p.last_seen_at,
           (select count(*) from progress g where g.user_id = p.id and g.solved_at is not null),
           (select coalesce(sum(g.attempts), 0)::bigint from progress g where g.user_id = p.id),
           (select count(*) from mock_sessions m where m.user_id = p.id)
    from profiles p
    order by p.created_at;
end $$;
grant execute on function public.admin_users() to authenticated;
