# Daily Learning study-time analytics

Status: implemented on branch `feature/daily-phase2`, not pushed, not deployed.

## What is measured

**Active study time per lesson.** A lesson page runs a timer while the learner is present: the tab is visible and the page has sent a recent heartbeat. It reuses the clock that already times SQL and Python challenges (`lib/solveSessions.ts`), so the rules are the same:

- A running segment counts at most 30 seconds past the last heartbeat (heartbeat every 10 seconds). A sleeping laptop, a closed tab or a clock jump therefore never inflates the total.
- The timer pauses by itself when the tab is hidden and resumes when it is visible again.
- Several tabs on the same lesson share one session and one clock. Time is never counted twice.
- A Pause click pauses every tab and stays paused until Resume.
- Sessions shorter than 5 seconds are dropped (a page opened by mistake).

**Away time** for a session is wall-clock time between start and end minus active time. It is shown as one line ("... away from lessons ... is not counted"). It is never added to the study total.

Study time is a record, not a score. It does not affect completion, mastery, the learning streak, the daily goal or revision scheduling.

## When a session is stored

1. The learner leaves the lesson (route change, switching day): the session is stored.
2. The tab is closed or crashes: the running timer stays in browser storage. The next Daily Learning page that loads sweeps any daily timer idle for more than 30 minutes and stores it, ending at its last heartbeat. The idle gap is not counted.
3. Pausing, hiding the tab and the heartbeat only update the browser-local timer; they do not write to the synced progress.

## Where it is stored

Inside the existing Daily Learning record: `Progress.daily.days[<dayId>].study`, a list of
`{ id, startedAt, endedAt, activeSec, awaySec }`.

- No new storage key for finished data, no new table, no migration. Old data without `study` loads unchanged.
- `Progress.sessions` (SQL/Python solve sessions) is not touched, so SQL and Python analytics, the planner and the insights page cannot be polluted by lesson time.
- The only browser-local addition is the running timer, kept in the existing active-session store under the key `day:<dayId>` with `kind: "daily"`.
- A lesson keeps at most 60 sessions; the oldest are dropped. This bounds storage only.
- Time is attributed to the date a session ended (a session that crosses midnight counts on the later date).

## Sync and merge

`study` rides the existing `profiles.state` JSON blob with the rest of `Progress.daily`. Merging two devices (`mergeStudy`, called from `mergeRecord`/`mergeDaily`) is:

- a union by session id, so a replay or repeated merge cannot double count;
- if the same id exists on both sides, the copy that ended later wins (a session only grows);
- order-independent and idempotent (both covered by tests).

Two devices that study the same lesson at the same time produce two different sessions, so both are counted. That is correct for presence on each device, and it can exceed the wall-clock time.

## What the dashboard shows (Daily Learning, "Study time")

- Today, last 7 days, total (with lesson and session counts).
- Average per completed lesson, with planned minutes against actual minutes for completed lessons.
- Last 8 weeks, one bar per 7-day window ending today.
- By phase, for the sequence the learner follows.
- Data Analyst path and Data Engineer path totals on one line, kept apart. The phase and week figures use only the learner's current sequence (common core plus the chosen path), so time from the other path is not mixed in.

The panel shows a short empty state until the first session is stored.

## Limits and honest caveats

- Not verified in a real browser over long sessions: multi-tab sharing, a laptop sleeping mid-session, and a closed tab followed by a sweep are covered by unit tests of the timer maths and the store, not by an end-to-end run.
- Not verified against Supabase: that `study` survives a real account sync, and two-device merge through the real backend. The merge function is unit tested; the network path is unchanged.
- "Active" means "tab visible with a recent heartbeat". A learner who leaves a lesson open in a visible tab and walks away is counted until the browser stops sending heartbeats; there is no input-activity detection.
- A running timer in a closed tab that is never reopened stays in that browser's storage until a Daily Learning page loads there.
- Per-lesson time is shown only in aggregate on the dashboard. The lesson page shows the running timer for the current session only.

## Tests

`src/test/siteDailyPhase2.test.ts` (24 tests): timer maths, grace, minimum length, commit, sweep, idempotent recording, merge across devices, account merge, analytics, branch separation.
`src/test/siteDailyPhase2Ui.test.tsx` (4 tests): timer on the lesson page, pause, store on leave, nothing stored for a short visit.
