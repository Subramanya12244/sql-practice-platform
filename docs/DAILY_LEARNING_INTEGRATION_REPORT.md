# Daily Learning Phase 2: integration report

Branch: `feature/daily-phase2`, based on `origin/main` at `fd7e135`. Status: working tree changes only. Nothing is committed, pushed, merged or deployed.

Scope: (1) reuse the solve timer for per-lesson study time, (2) write failed Daily Learning exercises into the Mistake Notebook, (3) per-day study-time analytics on the dashboard. `Progress.daily` and sync stay compatible, with no migration. See `DAILY_LEARNING_ANALYTICS.md` for the study-time design.

## 1. Timer integration

| Item | Result |
| --- | --- |
| Clock | Reuses `lib/solveSessions.ts` unchanged in behaviour: heartbeat, grace, auto-pause, shared multi-tab session. |
| Change to that file | `ActiveSession.kind` and `OpenMeta.kind` accept `"daily"` as well; `toSession` casts the kind; `sweepStale` skips daily timers; two small helpers (`takeActive`, `activeWithPrefix`). SQL and Python behaviour is unchanged (the existing solve-session tests pass). |
| New files | `lib/dailyStudy.ts` (pure), `lib/dailyStudyStore.ts` (browser glue), `components/daily/StudyTimer.tsx` (hook and pill). |
| Where it shows | Under the title of every authored lesson. Unwritten days have no timer. |
| Hydration | The pill renders nothing until mounted, so the prerendered HTML is unchanged and hydration cannot mismatch. `check:prerender` passes. |
| Isolation | Finished time goes to `Progress.daily`, never `Progress.sessions`, so SQL/Python analytics, the planner and insights cannot count lesson time. Tested. |

## 2. Mistake Notebook integration

| Item | Result |
| --- | --- |
| Trigger | A failed **Check answer** on a graded (Python or SQL) Daily Learning exercise. Plain Run errors are not recorded. Self-assessed (written) exercises cannot fail, so they record nothing. |
| Key | `daily:<dayId>#<exerciseId>`, one entry per exercise however often it fails (repeat failures raise its count; this is the deduplication). |
| Stored | Count and category only, never code or output (same as SQL and Python entries). Tested. |
| Category | Python: the exception name when the program crashed, otherwise "Wrong output". SQL: the existing error classifier on a failed run, otherwise the lesson's topics. |
| Resolve | A later pass calls the existing `markMistakeSolved`; the count and history are kept. "Understood" works as for other entries because it uses the same functions. |
| View | The existing Mistake Notebook lists these rows with `Daily · <phase>` as the topic and a link back to the lesson, next to SQL and Python rows. Filters and the "recurring mistakes" and improvement summaries include them. |
| Review | No new review queue. The lesson link is the review path; the existing lesson revision scheduling is unchanged. |
| Sync | Uses `Progress.mistakes`, merged by ref (`mergeMistakes`), so no new sync code. |

## 3. Dashboard analytics

A "Study time" section at the bottom of `/daily` (`StudyTimePanel`): today, last 7 days, total, average per completed lesson with plan versus actual, last 8 weeks, by phase, Analyst and Engineer totals. Details and definitions are in `DAILY_LEARNING_ANALYTICS.md`.

## 4. Compatibility

- `DayRecord.study?` is optional. Older stored progress and older remote state load and merge unchanged (tested).
- `mergeRecord` adds `study` only when either side has it, so the merged shape of old data is identical.
- No migration, no new table, no new sync field. The remote state already carries `daily`.
- A device on the previous build ignores `study` it does not know about; it may drop it if that device saves over a newer remote copy. This is the same limitation any new field has with the existing last-writer model and is not changed here.

## 5. Verification (local)

| Check | Result |
| --- | --- |
| `tsc --noEmit` | clean |
| ESLint | clean |
| New tests | `siteDailyPhase2.test.ts` 24 passed, `siteDailyPhase2Ui.test.tsx` 4 passed |
| Full Vitest | 5574 passed, 2 skipped, **3 failed**, all in `supabaseRls.test.ts` (admin analytics 008 and insights 012). The same 3 fail on an unmodified checkout of `origin/main` (`fd7e135`), so they are not caused by Phase 2. The cause was not investigated; the test file uses fixed 2026-11 dates and the run date is 2026-11-12, which is a suspect, not a finding. |
| Build and prerender | `build:site` prerendered 940 pages, `check:prerender` clean (built without Supabase env, so sign-in is absent in that local build; not deployed). |
| Playwright (local, desktop and mobile) | `daily.spec.ts` and `guided-labs.spec.ts`: 14 passed. |

## 6. Not verified

- Timer behaviour in a real browser over minutes: multi-tab sharing, sleep, a closed tab and the later sweep. Covered by unit and component tests only.
- Account sync of `study` through live Supabase, and two-device merge through the network.
- Any production behaviour: Phase 2 is not deployed.
- No new Playwright spec was added for the timer or the notebook rows.

## 7. Files

Modified: `lib/solveSessions.ts`, `lib/progress.ts`, `lib/dailyProgress.ts`, `lib/mistakes.ts`, `components/daily/LessonUi.tsx`, `pages/DailyPages.tsx`.
Added: `lib/dailyStudy.ts`, `lib/dailyStudyStore.ts`, `components/daily/StudyTimer.tsx`, `components/daily/StudyTimePanel.tsx`, `src/test/siteDailyPhase2.test.ts`, `src/test/siteDailyPhase2Ui.test.tsx`, and these two docs.

## 8. Release

Not requested. A commit, a push, a PR to `main` and the production deploy each need your approval. A merge to `main` deploys automatically through `.github/workflows/deploy.yml`.
