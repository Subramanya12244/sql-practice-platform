\set ON_ERROR_STOP 0
insert into auth.users (id,email,raw_user_meta_data) values ('00000000-0000-0000-0000-000000000001','u@x.local','{"username":"Subramanya.a"}'),('00000000-0000-0000-0000-000000000002','admin@x.local','{"username":"admin"}'),('00000000-0000-0000-0000-000000000003','subramanya.a@gmail.com','{}');
update public.profiles set role='admin' where username='admin';
select username, role from profiles order by created_at, username;
grant usage on schema public to authenticated; grant select,insert,update,delete on all tables in schema public to authenticated; grant usage on all sequences in schema public to authenticated;
set role authenticated; set request.jwt.sub='00000000-0000-0000-0000-000000000001';
insert into progress(user_id,question_number,attempts,solved_at) values ('00000000-0000-0000-0000-000000000001',1,1,now());
insert into progress(user_id,question_number,attempts) values ('00000000-0000-0000-0000-000000000002',1,1); -- expect RLS error
select count(*) as own_profiles_visible from profiles;
update profiles set role='admin' where id=auth.uid(); -- expect error
select admin_stats(); -- expect forbidden
insert into audit_log(user_id,action) values (auth.uid(),'login');
insert into audit_log(user_id,action) values (auth.uid(),'role_change'); -- expect RLS error
delete from audit_log; select count(*) audit_rows_after_delete from audit_log;
select email_for_username('subramanya.a');
set request.jwt.sub='00000000-0000-0000-0000-000000000002';
select admin_stats()->>'users' users, admin_stats()->>'solves' solves;
select username, solved from admin_users();
update profiles set role='admin' where username='subramanya.a1' or username='subramanya.a';
select action, detail->>'to' from audit_log order by id;
