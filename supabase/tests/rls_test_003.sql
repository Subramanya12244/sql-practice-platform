-- Run after rls_test.sql and rls_test_002.sql.
\set ON_ERROR_STOP 0
reset role;
grant select,insert,update,delete on all tables in schema public to authenticated; grant usage on all sequences in schema public to authenticated;
set role authenticated;
set request.jwt.sub='00000000-0000-0000-0000-000000000001';
insert into project_progress (user_id, project_slug, task_id, passed) values (auth.uid(), 'csv-to-postgres-etl', 'stage', true);
insert into project_submissions (user_id, project_slug, repo_url) values (auth.uid(), 'csv-to-postgres-etl', 'https://github.com/u/r');
insert into project_submissions (user_id, project_slug, status) values (auth.uid(), 'csv-to-postgres-etl', 'Completed');    -- RLS error: can't self-complete
insert into project_submissions (user_id, project_slug, repo_url) values (auth.uid(), 'x', 'http://evil.example/a/b');      -- check violation
update project_submissions set status = 'Completed';                                                                        -- 0 rows: not admin
insert into query_visualization_sessions (user_id, question_key, executed_sql) values (auth.uid(), 'q25', 'select 1');
set request.jwt.sub='00000000-0000-0000-0000-000000000003';
select count(*) as other_user_sees from project_progress;                                                                   -- 0
select count(*) as other_user_sessions from query_visualization_sessions;                                                   -- 0
set request.jwt.sub='00000000-0000-0000-0000-000000000002';
update project_submissions set status = 'Completed', reviewed_by = auth.uid(), reviewed_at = now();                         -- admin ok
select status from project_submissions;
