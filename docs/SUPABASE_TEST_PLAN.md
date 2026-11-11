# Supabase authentication and sync: live test plan

Status: **written, not run.** Nothing in this plan has been executed against a real Supabase project. Unit tests simulate the merge logic (`siteSolveSessions.test.ts`, `supabaseRls.test.ts`), and a bad login was checked against production, but sign-up, session restore and real two-device sync have not been verified.

## Where to run it

Do not run this against production without approval: it creates and deletes users. Use one of:

1. A separate free Supabase project with the migrations in `supabase/migrations/001-012` applied (recommended).
2. A local Supabase stack (needs the Supabase CLI and Docker).
3. Production, with the cleanup step below, only with your explicit approval.

Build the site against that project:
`VITE_SUPABASE_URL=... VITE_SUPABASE_ANON_KEY=... npm run dev:site`

The service-role key is never used by the tests. Cleanup uses `scripts/seed-accounts.mjs` or the Supabase dashboard, from your own shell.

## What the automated spec covers

`frontend/e2e/sync.spec.ts` (skipped unless `E2E_SYNC=1`). It creates two throwaway users named `e2e_sync_<random>` and checks, in two separate browser contexts (two devices):

| # | Check | Pass condition |
|---|---|---|
| 1 | Sign up | The account page shows the username |
| 2 | Logout and login | The same username is shown after login |
| 3 | Session restore | After a full reload the user is still signed in |
| 4 | Progress sync | A challenge solved on device A appears as solved on device B after login |
| 5 | Attempt sync | A solve session recorded on device A shows in device B's history |
| 6 | Duplicate prevention | Syncing twice leaves exactly one session |
| 7 | Offline then online | A session recorded while offline appears on the other device after reconnect |
| 8 | Conflict resolution | The same challenge solved on both devices keeps both sessions and the earliest solve time |

## Manual checks the spec cannot do

- Email confirmation flow, if the project has email confirmation enabled.
- Password reset email.
- GitHub connect (needs your GitHub account).

## Cleanup

Delete users whose username starts with `e2e_sync_` in Supabase Auth, then run `delete from profiles where username like 'e2e_sync_%'` if rows remain.

## Reporting

Record each check as passed, failed or not run, with the date and the Supabase project it ran against.
