-- Public portfolio: the opt-in public profile also lists reviewer-approved projects and the
-- portfolio name/headline. Apply after 004_submission_review.sql. Safe to re-run; replaces one
-- function, changes no tables.
--
-- Only data the learner chose to publish (public_profile = true) is returned, and only
-- submissions an admin marked Completed. Emails, notes and checklists are never exposed.

create or replace function public.public_profile(u text) returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'username', p.username,
    'joined', p.created_at,
    'solved', (select count(*) from progress g where g.user_id = p.id and g.solved_at is not null),
    'solvedNumbers', (select coalesce(jsonb_agg(g.question_number order by g.question_number), '[]'::jsonb)
                      from progress g where g.user_id = p.id and g.solved_at is not null),
    'activeDays', coalesce(p.state -> 'activeDays', '[]'::jsonb),
    'solutions', (select count(*) from solutions s where s.user_id = p.id and not s.hidden),
    'name', p.state #>> '{portfolio,name}',
    'headline', p.state #>> '{portfolio,headline}',
    'projects', (
      select coalesce(jsonb_agg(jsonb_build_object('slug', x.project_slug, 'repo', x.repo_url, 'approved_at', x.reviewed_at)
                                order by x.reviewed_at desc), '[]'::jsonb)
      from (
        select distinct on (s.project_slug) s.project_slug, s.repo_url, s.reviewed_at
        from project_submissions s
        where s.user_id = p.id and s.status = 'Completed'
        order by s.project_slug, s.reviewed_at desc
      ) x
    ))
  from profiles p where p.username = u::citext and p.public_profile;
$$;
grant execute on function public.public_profile(text) to anon, authenticated;
