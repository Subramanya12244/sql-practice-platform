# DataForge product audit (Phase 0)

Date: 2026-11-11. Baseline: branch `fix/suspense-prerender-and-session-sync` at `06c653d`, which is what production serves. It is not merged into `main` yet.

This audit answers one question before any new feature work: what already exists, what is partly built, and what is missing. It builds on the earlier gap analyses ([LEARNING_PLATFORM_PLAN.md](../LEARNING_PLATFORM_PLAN.md), [INTELLIGENCE_PLAN.md](../INTELLIGENCE_PLAN.md)) rather than replacing them. The proposed work is in [the roadmap](../roadmap/DATAFORGE_IMPLEMENTATION_ROADMAP.md).

## 1. Method and what was verified

- Read the code in `frontend/src/site/` (pages, components, lib), the content folders, `supabase/migrations/001-012`, the CI workflow and the existing plan documents.
- Ran the real production site in Chrome (Playwright) to verify each previously reported issue. Findings are in section 7. Nothing in this audit is based on assumption where a check was possible.
- Not verified: anything that needs a signed-in Supabase session. No credentials were available, and testing against production would create accounts in your database. Those items are marked "not verified".
- No application code was changed in Phase 0.

## 2. Existing architecture

### 2.1 Two applications in one repository

| App | Where | What it is |
|---|---|---|
| Public site (the product) | `frontend/src/site/`, built by `vite.site.config.ts` and `scripts/build-site.mjs` | Static, prerendered React site on Cloudflare Workers static assets. SQL and Python run in the browser. Accounts are optional (Supabase). |
| Local app | `frontend/src/` (not `site/`) and `backend/` (FastAPI) | Full Postgres stack for the repository owner. Not deployed. Out of scope for this roadmap. |

### 2.2 Public site

- **Routing and rendering.** React 18, `react-router-dom` 6. `routes.tsx` lists 64 route entries (including the catch-all). Each has an element, a `load` function that fetches its static JSON or Markdown data, and `paths()` for prerendering. The build prerenders about 663 pages (641 in the sitemap), generates 150 social images, and writes `dist-site/`.
- **Data.** Questions, notes, Python exercises, projects, scenarios and assessments are static files under `src/site/content/` and `public/data/`. There is no application server.
- **State.** No Redux or context store. Learner progress is one external store in `lib/progress.ts` (`useSyncExternalStore` over localStorage key `sqlp.public.progress`). Writes call a "sink" so a signed-in account mirrors the change. Other features keep their own small localStorage keys (list in 4.1).
- **SQL execution.** PGlite (PostgreSQL 18.6, WASM) in a Web Worker (`pglite.worker.ts`, `browserDb.ts`). Every query is wrapped in `BEGIN ... ROLLBACK`, runs on an isolated instance per dataset, and has an 8 second timeout after which the worker is terminated and restarted.
- **Python execution.** Pyodide 0.29.5 in a Worker (`pyodide.worker.ts`, `pyRunner.ts`), loaded from the jsDelivr CDN. A queue serializes runs, a watchdog stops runaway code, imports that reach the network are blocked, and a virtual file system backs multi-file workspaces. Learner tracebacks are cleaned by `pyErrors.ts`.
- **Editor.** Monaco through `@monaco-editor/react`, lazy-loaded in `CodeEditor.tsx` and mounted after client load.
- **Accounts and sync.** Supabase Auth plus Postgres with RLS. `lib/auth.tsx` merges the account copy into the browser copy at sign-in (`lib/account.ts mergeProgress`), then mirrors changes. Without the two `VITE_SUPABASE_*` variables the site runs anonymously.
- **Deployment.** `.github/workflows/deploy.yml` runs `tsc -b` and `vitest run`, builds with the Supabase variables from repository variables, and deploys with Wrangler **on every push to `main`**. A manual local deploy needs those variables too (see risk R7).
- **Tests.** Vitest and Testing Library. 52 files and 407 test cases at the time of writing (run with `TZ=UTC`, see R1), including PGlite-backed content validation (every SQL task solution passes and every starter fails), RLS tests that load the real migrations into PGlite, and module tests for the timer, history and analytics page. There is no linter and no committed browser test suite.

### 2.3 Learner-progress data flow

1. A page calls a function in `lib/progress.ts` (`recordAttempt`, `recordHint`, `completeExercise`, `recordSession` ...).
2. The function writes the new `Progress` object to localStorage and notifies subscribers.
3. If signed in, `setProgressSink` mirrors the change: per-question rows go to the `progress` table, everything else goes into the `profiles.state` JSON document.
4. At sign-in, `mergeProgress` takes the maximum attempts, the earliest solve, the union of days, mocks and sessions, and the higher review box.

## 3. Feature inventory against the requested list

Status key: **Exists** (works in production), **Partial** (a base exists, the requested behaviour does not), **Missing**.

### Phase 1: stability

| Request | Status | Evidence and gap |
|---|---|---|
| React error #419 | **Fixed, verified** | See 7.1. |
| Session integrity (duplicates, refresh, tabs, sleep, clock) | **Exists** | `lib/solveSessions.ts`: heartbeat plus grace time, one session per challenge, tab presence, validated-solve-only completion. 27 unit and 14 + 8 browser checks. Crash recovery works through the persisted heartbeat. |
| Supabase reliability (sign-up, login, sync, offline) | **Partial, not verified live** | Code and merge logic are unit-tested, including simulated two-device round trips. A bad login was verified against production (400, friendly message). Sign-up, session restore and real cross-device sync were not exercised. |
| Error monitoring | **Partial** | `lib/diagnostics.ts` classifies errors and keeps an in-memory ring buffer, fed by `sqlRunner`, `pyRunner` and `supabase`. `/debug` shows it. Gaps: the buffer is lost on reload, there are no global `error` or `unhandledrejection` handlers, no sync-failure capture, and nothing can be shared except by copy and paste. |

### Phase 2: learning intelligence

| # | Request | Status | Evidence and gap |
|---|---|---|---|
| 5 | Mistake Notebook | **Partial** | SQL stores `errorKinds` per question (`QuestionProgress`) and the dashboard shows "frequent mistakes" (`dashboard.ts getFrequentMistakes`). `/history` lists problems worth another try (`extras.ts sqlRevision`). Missing: grouping by topic as a notebook, Python error categories (Python stats only count attempts and passes), "mark as understood", filters, a retry flow and an improvement trend. |
| 6 | Intelligent SQL reviewer | **Partial** | `/solution-comparison` checks result equivalence, detects approaches, and times runs. `lib/tutor.ts` gives a rule-based schema check and clause explanation. `lib/errorHelp.ts` explains errors. Missing: an automatic review panel after submit (readability, NULL handling, join checks, alternatives) that reuses these pieces. |
| 7 | Spaced repetition | **Exists, simpler than requested** | `lib/revision.ts` (`RULES`) with `/review`: wrong gives 1 day, slow gives 3, correct gives 7, three correct in a row gives 30. Missing: the 1/3/7/14/30 ladder, adaptation by time and hints, overdue and upcoming views, completion statistics. Schedules already sync. |
| 8 | Personalized recommendations | **Exists in three places** | `dashboard.ts` (next SQL, next Python, active project), `insights.ts practiceNext`, `solveAnalytics.ts recommend` (explainable, tested), plus `/readiness`. Missing: one shared engine and sentence-style insights such as "you take longer on JOIN problems". |

### Phase 3: data engineering labs

| # | Request | Status | Evidence and gap |
|---|---|---|---|
| 9 | ETL pipeline builder | **Missing** | No visual builder. Reusable: `@xyflow/react` (already used by `SchemaFlow`, `QueryDiagram`, `MindMapCanvas`), PGlite, `dataset` loaders, sample datasets. |
| 10 | Database design playground | **Partial** | `/data-generator` designs tables, keys and messy data. `/schema` draws a read-only ER diagram. Missing: an interactive designer, normalization exercises, constraint and index teaching. |
| 11 | Data quality lab | **Exists** | `/data-quality`, `lib/dataQuality.ts`: 12 rule types, SQL per rule, score, reports, run comparison, profiling-style checks. Missing: Python-based fixes, a before/after dataset comparison, exercises (it is a tool, not a guided lab), and sync of runs (tables exist in migration 003, sync is not wired). |
| 12 | Orchestration simulator | **Missing** | Airflow content exists only as notes (`content/notes/airflow`) and one project. `/debug-lab` is about debugging pipelines, not scheduling. |

### Phase 4: interview preparation

| # | Request | Status | Evidence and gap |
|---|---|---|---|
| 13 | SQL interview mode | **Exists, partly** | `/mock-interview`: 5 questions, difficulty and 20/30/45/60 minute choice, no hints. `/assessments`: timed, server-checked by SHA-256 fingerprints so expected output never reaches the browser (migration 011), but needs an account. Missing in the mock: topic-wise feedback, query-quality feedback, hidden tests. |
| 14 | Python assessments | **Exists** | `/practice/python/assessment`: three problems, 30 to 90 minutes, visible and hidden tests, history, timer survives reload. Reuses the worker limits. |
| 15 | Scenario challenges | **Partial** | 16 business SQL scenarios, 12 guided projects (incremental loading, validation, retries, REST ingest, Airflow, dbt) and the pipeline debugging lab cover much of the list. Missing: dedicated scenarios for late-arriving data, idempotent loads and reconciliation with their own datasets and evaluation criteria. |

### Phase 5: career

| # | Request | Status | Evidence and gap |
|---|---|---|---|
| 16 | GitHub portfolio | **Exists, one risk** | `/portfolio` and `/portfolio/export` export solved work to a ZIP or push it to a GitHub repository. The GitHub connection requests the `repo` scope (R5). |
| 17 | Resume project generator | **Missing** | `career.ts portfolioMarkdown` builds a portfolio page, not resume bullets. Reusable: project metadata, completion evidence from `projects.ts`. |
| 18 | Learning planner | **Partial** | `/career/planner` builds a week-by-week plan from role, deadline and hours, and ticks items from real progress. A daily goal and a review queue exist. Missing: weekly targets that adapt, revision reminders (optional), project milestones. |

### Already built beyond the request (do not rebuild)

Solve timer with goal, attempt history, performance analytics with topic strength, heatmap and streaks, gamification (XP, achievements, missions, leaderboard), flashcards, notes (167), patterns, mind maps, concept guides, query visualizer, public playground with six datasets, data generator, study notes PDF, admin analytics, content management, community features.

## 4. Persistence and schema

### 4.1 Browser storage keys (all `sqlp.*`)

`public.progress` (the main `Progress` record), `public.mock`, `solve.active`, `solve.targetPref`, `activity.queue`, `activity.minutes`, `activity.sentMinutes`, `activity.session`, `py.stats`, `py.history.<slug>`, `pyassess.active`, `pyassess.history`, `assess.active`, `project.<slug>`, `dq.rules.<dataset>`, `dq.rulesAt.<dataset>`, `dq.runs.<dataset>`, `viz.<question>`, `custom.datasets`, `reviews.seen`, `handoff`.

### 4.2 `Progress` (single localStorage record, version 1)

Per-question evidence (`attempts`, `solvedAt`, `hintLevel`, `assisted`, `solveSec`, `errorKinds`, `lastSql`, review box) plus `activeDays`, `cards`, `mocks`, `lessons` (Python completions, keyed `py:<slug>`), `bookmarks`, `read`, `dayCounts`, `revision` (`sql:<n>` and `py:<slug>`), `answers`, `plan`, `portfolio`, and the new `sessions` array (capped at 300).

### 4.3 Supabase (migrations 001-012)

30 tables: `profiles` (with `state` jsonb), `progress`, `mock_sessions`, `audit_log`, `solutions`, `solution_likes`, `comments`, `weekly_challenges`, `query_visualization_sessions`, `project_catalog`, `project_auto_tasks`, `project_progress`, `project_submissions`, `submission_reviews`, `data_quality_rules`, `data_quality_runs`, `xp_events`, `achievement_definitions`, `mission_definitions`, `user_achievements`, `learning_sessions`, `learning_events`, `active_minutes`, `study_notes`, `question_overrides`, `question_versions`, `custom_questions`, `track_topics`, `assessment_items`, `assessment_attempts`. RLS is tested by loading the migrations into PGlite (`src/test/supabaseRls.test.ts`).

Solve sessions are stored only inside `profiles.state` (no table). That needs no migration and merges safely by id, but admins cannot query them in SQL.

## 5. Reusable building blocks

`ui.tsx` (Card, StatCard, Tabs, EmptyState, ErrorState, Skeleton, ProgressBar, Badge, buttons), `CodeEditor`, `PracticePanel`, `PythonWorkspace`, `SampleTable`, `SchemaFlow` / `QueryDiagram` (React Flow), `Markdown`, `HintLadder`, `SolveTimer`, `SessionHistory`, `useProgress`, `solveAnalytics.ts` (mastery, heatmap, streaks, recommendations), `revision.ts`, `errorHelp.ts`, `tutor.ts`, `compareSolutions.ts`, `dataQuality.ts`, `generator.ts`, `datasets.ts`, `tasks.ts` (validated SQL, Python, checklist and decision tasks), `portfolioExport.ts`, `diagnostics.ts`, `resultCompare.ts`, `sqlAst.ts` and `queryGraph.ts` (parsing).

## 6. Technical limitations

- Pyodide needs the jsDelivr CDN on first use, so Python is not fully offline.
- PGlite is a single-connection WASM Postgres. Large datasets are slow to load, and `pgsql-ast-parser` lacks INTERSECT, EXCEPT and `$$` strings (the clause fallback is labelled).
- `profiles.state` is rewritten in full on every sync write. Adding more features to it grows the row (sessions are already capped at 300 for this reason).
- No lint step in CI. Browser flows are tested only by scripts that live outside the repository.

## 7. Outstanding issues: verified status

| # | Reported concern | Verdict | Evidence |
|---|---|---|---|
| 1 | React error #419 (Suspense and lazy editor) | **Resolved** | Cause: the lazy editor inside `PythonWorkspace` suspended during server render. Fixed by mounting it after client load. 0 of 663 prerendered pages contain a failed boundary. Production hydrated with no console errors on project, Python, SQL and analytics pages. **No regression test yet** (roadmap item S1). |
| 2 | Supabase auth and real cross-device sync | **Still open** | Verified: login form, bad-login error path, sign-in link. Not verified: sign-up, session restore, real sync between two devices. Needs a safe Supabase project or explicit approval to use production with cleanup. |
| 3 | Multiple tabs overwrite one session | **Resolved** | Tabs share one session; time counts once while any tab is visible. 5 unit tests and 8 browser checks on production. Residual: two writes in the same millisecond can drop one counter increment. |
| 4 | Python timer on mobile | **Resolved** | 7 checks at 390 and 360 px on production: fits, pause, resume, check solves and records, finish confirm. |
| 5 | Mastery differs between Progress and Analytics | **Still open, confirmed** | `extras.ts masteryLevel` (Progress page: five levels from completion and independence only) and `solveAnalytics.ts masteryFor` (Analytics page: strong, developing, needs practice from completion, recent success, attempts, hints). Two vocabularies and two scores for the same topic. |
| 6 | Duplicate Monaco module console error | **Not reproducible** | Zero console errors or warnings on 7 production pages with editors. It appeared only under the Vite dev server earlier. |

## 8. Bugs and risks found during the audit

| ID | Risk | Severity | Notes |
|---|---|---|---|
| R1 | Three RLS tests fail between 00:00 and 05:30 IST | Low | They use the UTC date in JavaScript and the local date in Postgres. They pass under `TZ=UTC` (all 42), so CI is unaffected. Test-only fix. |
| R2 | Two mastery systems (issue 5) | Medium | Confusing to learners and doubles maintenance. |
| R3 | Diagnostics are in memory only | Medium | A failure that triggers a reload is lost, and uncaught errors outside React are not captured. |
| R4 | Old browser tabs can erase synced `sessions` | Low | A client that predates the field rewrites `profiles.state` without it. The signed-in device re-pushes its local copy on next sync, so loss needs local storage cleared too. |
| R5 | GitHub connect requests the `repo` scope | Medium | That is full control of the user's private repositories. A public-only option (`public_repo`) or a ZIP-only path should be the default. |
| R6 | Pyodide depends on a CDN | Low | First Python run fails offline. Could be self-hosted on Cloudflare (adds about 10 MB of static assets). |
| R7 | A local deploy without Supabase variables removes sign-in | High (process) | It happened on 2026-11-11 and was fixed the same day. Mitigation: deploy through CI, or keep the variables in `frontend/.env.local`. |
| R8 | Merging to `main` deploys to production | Process | By design, but it makes "do not deploy without approval" a merge-time decision. |
| R9 | Two timing sources | Low | Legacy `solveSec` (first interaction to first solve, wall clock) and the new session `activeSec`. Analytics uses sessions, readiness uses `solveSec`. |
| R10 | No lint and no committed browser tests | Medium | Regressions such as #419 are caught only by manual scripts. |
| R11 | Branch `fix/suspense-prerender-and-session-sync` is unmerged | Process | Production runs code that is not on `main`. |

## 9. Missing functionality (summary)

Missing entirely: ETL pipeline builder, orchestration (DAG) simulator, resume generator, Mistake Notebook as a dedicated feature, post-submit SQL review panel, extra data-engineering scenarios (late data, idempotency, reconciliation), normalization exercises and an interactive schema designer, persistent error log with opt-in sharing.

## 10. Proposed architecture changes

1. **One mastery module.** Make `solveAnalytics.masteryFor` the single source and have the Progress page read it. Keep the five Progress labels only if the same score maps to them.
2. **One insight engine** (`lib/insights/*`): rules over `Progress`, sessions and revision data that return `{ id, severity, text, evidence, action }`. The dashboard, analytics and revision pages render it.
3. **Mistake model.** Add `Progress.mistakes` keyed by question: `{ category, count, firstAt, lastAt, understood?, solvedAfter }`. Categories come from `errorHelp` (SQL) and a new small Python classifier on exception names (reusing `pyErrors`). No source code is stored. Rides `profiles.state`, merged by key.
4. **Revision v2** inside `revision.ts`: the 1/3/7/14/30 ladder as a data table, adjusted by time, hints and attempts, with overdue and upcoming views. Same `Progress.revision` shape, so old data keeps working.
5. **Lab framework.** A shared workspace shell for the three simulators built on React Flow and PGlite or a small pure-TypeScript engine, with save and load in localStorage. The simulators run as pure functions (graph in, run log out) so they are fully unit-testable.
6. **Error log.** A bounded, redacted log persisted to localStorage, global handlers, shown in `/debug`, with an explicit "copy report" action. No network upload in the first version.
7. **Regression guards.** A CI step that fails if any prerendered page contains `<!--$!-->`, a lint step, and a small committed Playwright smoke suite.

Database changes: none are required for items 1 to 7. Anything that must be queried by admins (for example session analytics) would need a table, and the audit recommends waiting until there is a concrete admin use.

## 11. Dependency map

```
S1 hydration guard ──┐
S2 error log ────────┤
S3 sign-in/sync test ┴─> (independent, do first)

Mastery unification ──> Insight engine ──> Recommendations v2 ──> Planner v2
Mistake model ────────> Mistake Notebook ─┬─> Revision v2
                                          └─> Insight engine
SQL review panel ─────> (reuses compareSolutions, errorHelp, tutor)
Lab framework ────────> ETL builder ─┬─> DAG simulator
                                     └─> Scenario challenges (datasets)
Data quality lab guides ─> (reuses dataQuality, generator)
Interview mode v2 ────> (needs SQL review panel and mistake model for feedback)
Resume generator ─────> (needs project completion data, already present)
```

## 12. Estimates

Engineer-days including tests and review, one engineer, rough.

| Area | Estimate |
|---|---|
| Phase 1 stability (guard, error log, sync test harness) | 4 to 6 days |
| Mastery unification and insight engine | 3 to 4 days |
| Mistake Notebook | 4 to 5 days |
| Revision v2 | 3 days |
| SQL review panel | 4 to 5 days |
| Recommendations v2 and planner v2 | 4 to 5 days |
| ETL pipeline builder | 10 to 14 days |
| DAG simulator | 7 to 9 days |
| Database design playground | 6 to 8 days |
| Data quality lab guided exercises | 4 to 5 days |
| Interview mode v2 and Python assessment polish | 4 to 5 days |
| Scenario challenges (content heavy) | 6 to 10 days |
| Resume generator and portfolio scope fix | 3 to 4 days |

These are sizing estimates, not commitments.
