-- Run after rls_test.sql (users 1 = Subramanya.a with Q1 solved, 2 = admin, 3 = other user).
\set ON_ERROR_STOP 0
reset role;
update profiles set role = 'user' where username <> 'admin';
update profiles set public_profile = true where username in ('Subramanya.a', 'admin');
insert into weekly_challenges values (date_trunc('week', now())::date, '{1,2}');
grant select,insert,update,delete on all tables in schema public to authenticated; grant usage on all sequences in schema public to authenticated;
set role authenticated;
set request.jwt.sub='00000000-0000-0000-0000-000000000001';
insert into solutions (user_id, question_number, sql) values (auth.uid(), 1, 'select 1');           -- ok: solved
insert into solutions (user_id, question_number, sql) values (auth.uid(), 2, 'select 2');           -- RLS error: not solved
insert into comments (question_number, user_id, body) values (1, auth.uid(), 'nice one');
update comments set hidden = true;                                                                    -- 0 rows: not admin
select count(*) as q1_solutions_visible_to_solver from question_solutions(1);
set request.jwt.sub='00000000-0000-0000-0000-000000000003';
select count(*) as q1_solutions_visible_to_unsolved from question_solutions(1);                      -- 0: no spoilers
insert into solution_likes select id, auth.uid() from solutions;                                      -- ok
select count(*) as comments_visible from question_comments(1);
set request.jwt.sub='00000000-0000-0000-0000-000000000002';
update comments set hidden = true where question_number = 1;                                           -- admin ok
set request.jwt.sub='00000000-0000-0000-0000-000000000003';
select count(*) as comments_after_hide from question_comments(1);                                     -- 0
select * from leaderboard('week');
select public_profile('Subramanya.a') ->> 'solved' as public_solved, public_profile('subramanya.a1') as private_profile;
select * from challenge_ranking();
reset role;
select action, detail ->> 'table' from audit_log where action = 'comment_hide';
