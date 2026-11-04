# Supabase: setup, review workflow and end-to-end testing

Accounts are optional. Without the two `VITE_SUPABASE_*` variables the site runs anonymously and
keeps everything in browser storage. This page covers what changes when Supabase is configured.

## Environment variables

| Variable | Where | Secret? |
| --- | --- | --- |
| `VITE_SUPABASE_URL` | Cloudflare build env, GitHub repo secret, `frontend/.env.local` | No |
| `VITE_SUPABASE_ANON_KEY` | same as above | No: public by design, RLS protects the data |
| `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` | your own shell only, for `scripts/seed-accounts.mjs` | **Yes** |

Never put the service-role key in a `VITE_` variable, in `.env.local` of a build, or in CI that
builds the site. The service role bypasses RLS. No frontend code reads it.

## Applying migrations

Run each file in the Supabase SQL editor, in this order. Every file is safe to re-run and adds
objects only; none drops tables or deletes rows.

1. `supabase/migrations/001_accounts.sql`: profiles, progress, mock sessions, audit log, admin RPCs.
2. `supabase/migrations/002_community.sql`: solutions, likes, comments, challenges, leaderboard.
3. `supabase/migrations/003_dataforge.sql`: visualization sessions, project progress and
   submissions, data quality rules and runs.
4. `supabase/migrations/004_submission_review.sql`: admin review of project submissions.
5. `supabase/migrations/005_public_portfolio.sql`: public profiles also list reviewer-approved projects and the portfolio name and headline. It replaces one function and changes no tables.

Re-running 002 after 004 resets the audit-action list to 002's list. If you do, run 004 again.

Migration 004 was needed because 003 had no column for reviewer comments, no review history, and
no "Rejected" status. It:
- adds `Rejected` to the allowed submission statuses (existing values stay valid)
- adds `project_submissions.review_comment`
- adds the `submission_reviews` history table (read: the submitter and admins; nobody inserts directly)
- adds a trigger on `project_submissions`:
  - a learner's insert always starts as `Submitted`, with no reviewer fields
  - only admins can update, and only `status` and `review_comment`
  - `reviewed_by` and `reviewed_at` are set by the database
  - every review appends a `submission_reviews` row and a `submission_review` audit entry
- adds a `NOT VALID` check so `checklist:` rows in `project_progress` can never have `passed = true`.
  Existing rows are not rewritten.

## Roles

- **user**: the default for every signup. Reads and writes only their own rows.
- **admin**: set `profiles.role = 'admin'`, either from `/admin` by another admin, or once in the SQL
  editor (`update profiles set role = 'admin' where username = '…'`). The seed script creates
  `admin` with a forced password change.

Admin checks happen in the database (`public.is_admin()` in RLS policies and triggers). The `/admin`
route also hides itself from non-admins, but that is only presentation.

## How project data is stored

- Automated task results are `project_progress` rows, keyed `(user_id, project_slug, task_id)`.
- Checklist ticks are `project_progress` rows with `task_id = 'checklist:<task id>'`, `passed = false`
  and the ticks as a JSON array in `code`. They upsert on the same key, so they never duplicate.
  The client never turns them into tasks, so they don't count towards passed tasks or completion.
- Submissions are `project_submissions` rows. Each submit adds one row; the newest one is current.
  The browser matches its own submission to the account copy by timestamp, so syncing doesn't
  insert it twice.
- A project with manual steps only becomes **Completed** when an admin approves it. Nothing in the
  app approves automatically.

## Reviewing submissions

In `/admin`, under **Project submissions**:
- search by user, project, notes or link, and filter by user, project, status and date range
- open a submission to see the repository link, notes, checklist completion and review history
- add a comment, then choose **Approve** (`Completed`), **Request changes**, **Reject** or
  **Mark under evaluation**
- Request changes and Reject need a comment

The learner sees the status and the reviewer's comment on the project page after their next sign-in
or page load.

## Automated tests

`frontend/src/test/supabaseRls.test.ts` applies 001–004 in order on PGlite (real PostgreSQL) with
`supabase/tests/auth_stub.sql`, then checks, as two learners, an admin and anon:
- re-applying 003 and 004 is safe
- checklist rows upsert in place and can't be marked passed
- one learner can't read, update, delete, or insert rows for another; anon sees nothing
- a learner can't self-approve or review
- admin reviews are stamped by the database, kept in history and audited
- admins can't change the learner's submitted content, and nobody writes history directly

`frontend/src/test/siteDataSync.test.ts` covers the client side:
- merging and pushing on sign-in
- skipping sync when tables are missing
- review status on the project page
- dedupe across timestamp formats
- the admin search helpers

Run with `cd frontend && npx vitest run`.

These tests stub Supabase Auth and PostgREST. They don't replace the live check below.

## Two-browser test (live project)

Use two separate browser profiles (or one normal and one private window) so sessions don't mix.

1. Apply 001–004. Sign up as **learner A** in browser 1 and **learner B** in browser 2.
2. **Sessions:** in each browser, refresh. You stay signed in, as the right user.
3. **Isolation:** as A, open a project, pass a SQL task, tick a checklist item, run a data quality
   check, and visualize a query. As B, open the same pages: none of A's work shows.
4. **Cross-device sync:** sign in as A in browser 2 (after B signs out). A's task, checklist ticks,
   visualization session and quality run all appear. Tick another checklist item and refresh in
   browser 1: it appears there too.
5. **Submission:** as A, submit the project with a GitHub link. The status is *Under evaluation* (if
   all automated tasks pass) or *Submitted*.
6. **Admin only:** as B, open `/admin`: it shows 403. In the browser console as B, run an update on
   `project_submissions`: it changes 0 rows.
7. **Review:** sign in as an admin, open `/admin` → Project submissions, find A's submission, add a
   comment and choose **Request changes**. History shows the change, with the admin's name and time.
8. As A, reload the project: status *Changes requested* with the comment. Resubmit. As admin,
   **Approve**. As A, reload: *Completed*.
9. **Logout/login:** as A, sign out. The project's local data is cleared from that browser. Sign
   back in: everything returns from the account.

## Known limitations

- Task passes are recorded by the browser after the in-browser check runs. RLS ensures a user can
  only write their own rows, but the database can't re-run the check. Treat `passed` as
  self-reported evidence; the admin review is the trusted signal.
- Sync happens at sign-in and on each save. Two browsers open at the same time don't push changes to
  each other live; reload to pick up the other's changes.
- Data quality rules sync as a whole set per dataset, and the most recent save wins.
- The admin list loads the newest 200 submissions matching the filters.
- Learners see review results on their next page load, with no notification.
- Uploaded files aren't supported; submissions carry a repository link and notes.
