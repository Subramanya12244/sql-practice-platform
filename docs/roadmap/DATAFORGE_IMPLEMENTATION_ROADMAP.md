# DataForge implementation roadmap

Date: 2026-11-11. Companion to [DATAFORGE_PRODUCT_AUDIT.md](../architecture/DATAFORGE_PRODUCT_AUDIT.md), which lists what exists today. Read it first: many requested features already exist in some form, so most items below extend existing code instead of adding new systems.

Nothing here is started. Each phase is one branch, one reviewable set of commits, and waits for approval before work begins, before pushing, and before any deployment.

## 1. Rules that apply to every phase

- Extend, do not duplicate. Each item names the existing code it reuses.
- No new paid services, no mandatory AI. Everything in this roadmap is deterministic and runs in the browser.
- No new Supabase table or dependency unless the item says why existing structures are not enough. Most items add a field to `Progress` (synced inside `profiles.state`, merged by key) and need no migration.
- Old localStorage and Supabase data must keep working: new fields are optional and ignored by older code.
- Every item ships with loading, empty, error and success states, a responsive layout checked at 1440, 1024, 768, 390 and 360 px, keyboard access, and tests.
- Each phase ends with: `tsc -b`, the full unit suite with `TZ=UTC`, a production build with a prerender check, desktop and mobile browser checks, a short report, and a commit.
- Deploys go through approval. Local deploys must include the Supabase variables (audit risk R7); CI deploys on merge to `main` (R8).

## 2. Prioritization

Scores are relative: value to learners, engineering effort, risk to existing behaviour, how much else depends on it, and performance impact. H = high, M = medium, L = low.

| ID | Item | Value | Effort | Risk | Unblocks | Perf impact | Rank |
|---|---|---|---|---|---|---|---|
| S1 | Hydration regression guard, lint, browser smoke suite | H | L | L | everything | none | 1 |
| S2 | Persistent redacted error log | M | L | L | support, S4 | negligible | 2 |
| S3 | Supabase auth and sync verification | H | M | M (needs a safe project) | all sync claims | none | 3 |
| S4 | Mastery unification | M | L | L | insights, planner | none | 4 |
| 5 | Mistake model and Notebook | H | M | L | revision, insights, interview feedback | small | 5 |
| 7 | Revision v2 (ladder, overdue, stats) | H | M | L | planner | none | 6 |
| 8 | Insight and recommendation engine | H | M | L | planner, notebook | none | 7 |
| 6 | SQL review panel | H | M | M (must not mis-grade) | interview feedback | small (EXPLAIN) | 8 |
| 13 | SQL interview mode v2 | H | M | L | none | none | 9 |
| 14 | Python assessment polish | M | L | L | none | none | 10 |
| 16 | GitHub scope and portfolio fix | M | L | L | resume | none | 11 |
| 17 | Resume project generator | M | L | L | none | none | 12 |
| 18 | Learning planner v2 | M | M | L | none | none | 13 |
| 11 | Data quality lab guided exercises | M | M | L | scenarios | none | 14 |
| 15 | Data engineering scenarios | H | H (content) | L | none | dataset size | 15 |
| 10 | Database design playground | M | H | M | none | PGlite load | 16 |
| 9 | ETL pipeline builder | H | H | M | DAG simulator, scenarios | new lazy bundle | 17 |
| 12 | Orchestration simulator | M | H | M | none | new lazy bundle | 18 |

The order differs from the numbering in the request on purpose. The cheap, high-value items that sharpen existing screens (rank 5 to 13) come before the three large new labs, because the labs share one framework and are best built together once the base is stable.

## 3. Recommended phases

| Phase | Contents | Estimate | Exit condition |
|---|---|---|---|
| 1. Stability | S1, S2, S3, S4 | 4 to 6 days | CI fails on a failed Suspense marker; error log persists; Supabase checks pass or are explicitly waived; one mastery score |
| 2. Learning intelligence | 5, 7, 8, 6 | 14 to 17 days | Notebook, revision v2, insights and review panel live with tests |
| 3. Interview and career | 13, 14, 16, 17, 18 | 12 to 15 days | Interview feedback, resume generator, planner v2 |
| 4. Data engineering labs | 11, 15, 10, 9, 12 | 33 to 46 days | Labs share one framework and are lazy-loaded |

## 4. Phase 1: stability (recommended first)

### S1. Regression guards (React #419 and friends)

- **Existing to reuse:** `scripts/build-site.mjs` (prerender), `.github/workflows/deploy.yml`, the Playwright scripts used during this audit.
- **Files likely to change:** `deploy.yml`, `package.json` (add `lint`), `scripts/check-prerender.mjs` (new), `src/test/` (new test), a new `frontend/e2e/` folder.
- **New:** a script that scans `dist-site/**/index.html` for `<!--$!-->` and fails the build; ESLint config with `react-hooks` rules (the one new dev dependency; open source); a small committed Playwright smoke suite (timer, SQL run, Python run, two-tab, mobile menu) that runs against `vite preview` in CI.
- **Database:** none.
- **Dependencies:** `eslint`, `@playwright/test` (dev only, free).
- **Risks:** lint will report existing violations; fix or scope them in the same change. Browser tests in CI can be slow or flaky; keep the suite under about 20 tests and retry once.
- **Complexity:** low.
- **Tests:** the guard itself is tested by feeding it a page with the marker. The smoke suite is the test.
- **Acceptance:** CI fails when any prerendered page has a failed Suspense boundary; `npm run lint` passes; the smoke suite passes on desktop and mobile viewports.

### S2. Persistent, redacted error log

- **Existing:** `lib/diagnostics.ts` (classification, ring buffer, report), `pages/DebugCenterPage.tsx`, `ErrorBoundary`, callers in `sqlRunner`, `pyRunner`, `supabase`.
- **Files:** `diagnostics.ts`, `Providers.tsx` (global handlers), `auth.tsx` and `dataSync.ts` (sync failures), `DebugCenterPage.tsx`.
- **New:** persist the buffer to `sqlp.diag.log` (capped at 200 events, 90 days); `window` `error` and `unhandledrejection` handlers; a redaction function that removes source code, SQL text, tokens and emails and keeps category, code, route, duration and a truncated message.
- **Database:** none. No network upload in this version; the user copies a report from `/debug`.
- **Dependencies:** none.
- **Risks:** accidentally logging learner code. Mitigation: events carry only fixed fields, enforced by a type and a test that scans events for any string longer than 300 characters.
- **Complexity:** low.
- **Tests:** unit tests for redaction, cap, persistence and handler capture; module test for the Debug Center list; one browser check that a thrown error appears after reload.
- **Acceptance:** SQL failure, Python failure, worker init error, worker timeout, auth error, sync failure and an uncaught exception each produce one redacted, persisted event visible in `/debug`.

### S3. Supabase authentication and sync verification

- **Existing:** `auth.tsx`, `account.ts`, `dataSync.ts`, `docs/SUPABASE.md`, `scripts/seed-accounts.mjs`, `supabase/tests/*`, the simulated two-device tests.
- **Files:** a new `docs/SUPABASE_TEST_PLAN.md` and a gated `e2e/sync.spec.ts`.
- **New:** a repeatable live test that creates two throwaway users with a unique prefix, signs up, signs in on two browser contexts, solves and times a challenge on each, goes offline and back, and asserts convergence with no duplicate sessions, then deletes the users.
- **Database:** none.
- **Dependencies:** a Supabase project that is safe to test against.
- **Risk:** this needs your decision. Running it on production creates and deletes test users there. Options: a separate free Supabase project (recommended), local Supabase through Docker, or approved production use with the cleanup step. Service-role keys stay in your shell only.
- **Complexity:** medium.
- **Tests:** the test itself. Items without credentials stay marked "not tested".
- **Acceptance:** sign-up, login, logout, session restore, progress sync, attempt sync, duplicate prevention, conflict resolution, cross-device sync and offline-then-online sync pass, or the report states exactly which were not run.

### S4. Single mastery score

- **Existing:** `extras.ts masteryLevel`, `sqlMastery`, `pyMastery` (Progress page); `solveAnalytics.ts masteryFor` (Analytics page).
- **Files:** `solveAnalytics.ts`, `extras.ts`, `ProgressPage.tsx`, `PerformancePage.tsx`, `readiness.ts` (read only).
- **New:** none. `masteryFor` becomes the only scorer; the Progress page maps its score to labels, or adopts the Analytics labels.
- **Database:** none. Dependencies: none.
- **Risks:** learners see their level change. Mitigation: a one-line note on the Progress page explaining the signals used.
- **Complexity:** low.
- **Tests:** golden tests that the same input gives the same level on both pages; keep the existing mastery tests green or replace them deliberately.
- **Acceptance:** both pages show the same level and score for every topic.

## 5. Phase 2: learning intelligence

### 5. Mistake model and Mistake Notebook

- **Existing:** `QuestionProgress.errorKinds`, `errorHelp.ts`, `dashboard.ts getFrequentMistakes`, `extras.ts sqlRevision`, `HistoryPage`, `pyErrors.ts`, `pyPractice.feedbackFor`, `PracticePanel` (where SQL failures are classified).
- **Files:** `progress.ts` (new `mistakes` field and `recordMistake`), `PracticePanel.tsx`, `PythonPracticePages.tsx` (record on failed check), `account.ts` (merge by key), `routes.tsx`, `navigation.ts`.
- **New:** `lib/mistakes.ts` (categories, grouping, trend), `pages/MistakeNotebookPage.tsx` at `/mistakes`, a Python error classifier based on the exception name.
- **Data model:** `Progress.mistakes[ref] = { category, topic, count, firstAt, lastAt, understood?, solvedAfter?, lastKind }`. Counts and categories only; never source code.
- **Database:** none (`profiles.state`). Merge: max count, earliest `firstAt`, latest `lastAt`, `understood` wins if newer.
- **Dependencies:** none.
- **Risks:** wrong categories. Use the existing deterministic classifier and show "Other" instead of guessing.
- **Complexity:** medium.
- **Tests:** classifier table tests, merge tests, module test for filters, browser flow: fail, see it in the notebook, retry, solve, see "improved".
- **Acceptance:** failed SQL and Python attempts appear by topic with counts and error category; filter by language and topic; retry opens the question; mark understood persists across refresh and syncs; recurring mistakes are highlighted; improvement shows after a later solve.

### 7. Revision v2

- **Existing:** `revision.ts` (`RULES`, `nextRevision`, `revisionQueue`, `splitQueue`, `mergeRevision`), `ReviewPage`, `Progress.revision`.
- **Files:** `revision.ts`, `ReviewPage.tsx`, `progress.ts schedulePython` and its SQL counterpart.
- **New:** a ladder table `[1, 3, 7, 14, 30]` days indexed by `stage`; stage up on a correct answer, back one on slow, back to 1 on wrong; an adjustment for hints and attempts; today, overdue and upcoming groups; completion statistics (done this week, on-time rate).
- **Data model:** extend `RevItem` with an optional `stage` and `reviews` count; old items without them map to the nearest stage from their interval.
- **Database:** none. Dependencies: none.
- **Risks:** changing schedules under learners. Mitigation: migrate by stage mapping, never by resetting due dates.
- **Complexity:** medium.
- **Tests:** table-driven schedule tests (each outcome from each stage), migration test from old items, merge test, browser check of the three lists.
- **Acceptance:** the five intervals apply as specified, adapt to hints, time and attempts as documented in the rules shown to the learner, and old schedules survive.

### 8. Insight and recommendation engine

- **Existing:** `dashboard.ts`, `insights.ts`, `solveAnalytics.ts recommend`, `readiness.ts`, `PerformancePage`, `LearningAnalytics`.
- **Files:** new `lib/insights/*.ts`; consumers: `PerformancePage`, `LearnPages` dashboard, `ReviewPage`.
- **New:** `generateInsights(progress, sessions, revision, index, exercises) -> Insight[]` with rules such as low success in a topic, slower than own average on a topic, frequent hints in a Python category, "revise X before Y" from the topic order, plus recommendations for revision, weak topics, projects and interview exercises. Every insight carries its evidence.
- **Database:** none. Dependencies: none.
- **Risks:** noisy or wrong advice. Mitigation: minimum sample sizes, evidence text, and a cap of five insights.
- **Complexity:** medium.
- **Tests:** one fixture per rule, a "not enough data" case per rule, wording snapshot tests.
- **Acceptance:** insights appear only with enough data, each states what it is based on, and the existing recommendation lists use the same engine.

### 6. SQL review panel

- **Existing:** `compareSolutions.ts` (approach detection, equivalence, timing), `tutor.ts`, `errorHelp.ts`, `sqlAst.ts`, `resultCompare.ts`, `PlanTree` and `parsePlan` (EXPLAIN), `PracticePanel`.
- **Files:** `PracticePanel.tsx` (show the panel after a correct submit), new `lib/sqlReview.ts` and `components/SqlReview.tsx`.
- **New:** a review with findings labelled **Verified** (from execution, for example "returns the expected rows", "result is stable without ORDER BY", measured timing against the reference), **Heuristic** (readability, NULL handling hints, select-star, implicit joins, repeated subquery, an alternative with CTE or JOIN) and **Not assessed**. An alternative is only offered with the check that it returns the same rows. Performance claims use EXPLAIN cost on the real data and say "on this dataset"; they never say "faster" without a measurement.
- **Database:** none. Dependencies: none. No AI.
- **Risks:** mislabelling a correct query. Correctness is only ever the existing grader's verdict; the panel never changes pass or fail.
- **Complexity:** medium.
- **Tests:** fixtures of known queries (correlated subquery, JOIN, CTE, window) with expected findings and labels; a test that every alternative produces the same result set; a test that a structurally different but correct query is never flagged wrong.
- **Acceptance:** after a submit the learner sees which findings are verified and which are heuristics, an alternative with evidence it matches, and no unsupported speed claims.

## 6. Phase 3: interview and career

### 13. SQL interview mode v2

- **Existing:** `MockInterviewPage`, `mock.ts`, `Progress.mocks`, `AssessmentsPage` and `assessment.ts` (server-checked, hidden expected output).
- **Files:** `MockInterviewPage.tsx`, `mock.ts`, `progress.ts` (extend the mock record).
- **New:** a 30 and 60 minute preset, per-topic results, query-quality notes from the review engine (heuristics only, labelled), revision suggestions that feed the Mistake Notebook, hidden-test indicators where the question has them. Account-backed assessments stay as they are.
- **Database:** none. Dependencies: items 5 and 6.
- **Risks:** leaking solutions before submit (keep the existing rule); long sessions on slow devices.
- **Complexity:** medium.
- **Tests:** unit tests for scoring and topic breakdown; browser run of a 20 minute mock with a shortened timer; check that no solution is in the DOM before submit.
- **Acceptance:** score, correct and incorrect, time, topic performance, quality notes and revision areas are shown; no hints, solutions or expected outputs before submit.

### 14. Python assessment polish

- **Existing:** `PythonAssessmentPage`, the worker limits, `pyErrors`, solve sessions.
- **Files:** `PythonAssessmentPage.tsx`, `pyPractice.ts`.
- **New:** per-problem submission history and performance statistics, an explicit edge-case result list, resource-limit messages.
- **Database:** none. Dependencies: none.
- **Risks:** low; worker watchdogs already exist.
- **Complexity:** low.
- **Tests:** worker timeout and recovery (infinite loop, then a normal run), history persistence, mobile run.
- **Acceptance:** history and statistics are shown per assessment; a runaway program is stopped and the next run works.

### 16. GitHub connection scope

- **Existing:** `PortfolioExportPage`, `portfolioExport.ts`, `linkIdentity({ scopes: "repo" })`.
- **Files:** `PortfolioExportPage.tsx`.
- **New:** a "public repositories only" choice using `public_repo`, ZIP export as the default, plain explanation of what each choice allows. The token stays in memory only, as today.
- **Database:** none. Dependencies: none.
- **Risks:** push to a private repository then needs the broader scope; keep it opt-in and explained.
- **Complexity:** low.
- **Tests:** unit test of scope selection; a mocked push test; manual connect check by you (needs your GitHub account).
- **Acceptance:** nothing broader than needed is requested by default.

### 17. Resume project generator

- **Existing:** `projects.ts` (status, tasks), `career.ts portfolioMarkdown`, project content front matter (technologies, skills).
- **Files:** new `lib/resume.ts`, section on `PortfolioPage`.
- **New:** for each completed project, bullets built only from project metadata and verified task completion: title, business problem (from the project description), implementation (from task titles that passed), technologies, techniques. Metrics appear only when measured values exist (for example row counts from a validation run); otherwise the text says nothing about outcomes. The learner can edit and copy; edits are stored locally.
- **Database:** none. Dependencies: none.
- **Risks:** overclaiming. A test asserts that no bullet mentions a skill or number that is not in the evidence.
- **Complexity:** low.
- **Tests:** unit tests for evidence-only generation, empty state with no completed projects, edit persistence.
- **Acceptance:** generated text never invents a metric or a skill; users can edit.

### 18. Learning planner v2

- **Existing:** `career.ts` (`PlanSettings`, `schedule`), `/career/planner`, daily goal and `dayCounts`, revision queue.
- **Files:** `career.ts`, `CareerPages.tsx`.
- **New:** weekly targets compared with actual practice (from sessions), topic schedule for weak areas (from the insight engine), project milestones, optional reminders (a visible banner and an optional browser notification; off by default).
- **Database:** none. Dependencies: items 7 and 8.
- **Risks:** notification permission prompts; ask only on an explicit click.
- **Complexity:** medium.
- **Tests:** schedule tests, reminder opt-in tests.
- **Acceptance:** targets, schedule, milestones and statistics display from real data; reminders are off until enabled.

## 7. Phase 4: data engineering labs

All five labs share one **lab framework**: a workspace shell (toolbar, canvas, side panel, log), a pure-TypeScript run engine, a saved-document store in localStorage (`sqlp.lab.<kind>.<id>`), and lazy loading so none of it is in the main bundle. Build the framework first, with the ETL builder as its first consumer.

### 9. Interactive ETL pipeline builder

- **Existing:** `@xyflow/react` (already a dependency), `SampleTable`, PGlite and datasets, `tasks.ts` validation, `generator.ts`.
- **New:** `pages/EtlBuilderPage.tsx`, `lib/lab/etl/` (node types: CSV and JSON source, database source, select columns, filter, type convert, null handling, dedupe, aggregate, join, validate, output), an accessible alternative to drag and drop (add-node menu and keyboard connect), configuration panel, per-node preview, run log, saved pipelines.
- **Engine:** pure functions over arrays of records so it is unit-testable and runs in the main thread for small samples and in a Worker for large ones.
- **Database:** none. Dependencies: none new.
- **Risks:** scope creep; memory with large sample files. Cap samples (for example 50,000 rows) and show the cap.
- **Complexity:** high.
- **Tests:** engine tests per node type, graph validation (cycles, missing inputs), save and load, browser test of building a five-stage pipeline.
- **Acceptance:** a user can build Source to Extract to Transform to Validate to Load on sample data, see previews and logs, hit and read errors, save and reload.

### 12. Pipeline orchestration (DAG) simulator

- **Existing:** the lab framework, React Flow, Airflow notes and the `airflow-etl-pipeline` project for explanations.
- **New:** `lib/lab/dag/` (tasks, dependencies, schedule, retries, injected failures, a deterministic virtual clock), a run history, a log view, and "this is Airflow's ..." explanations next to each concept.
- **Database:** none. Dependencies: framework from item 9.
- **Risks:** misleading Airflow semantics. Keep to documented behaviour (retries, retry delay, trigger rules limited to all-success and all-done) and label simplifications.
- **Complexity:** high.
- **Tests:** engine tests (ordering, retry counts, failure propagation, rerun of failed tasks), deterministic-clock tests, browser smoke.
- **Acceptance:** create tasks and dependencies, set schedule and retries, inject a failure, retry it, and see the history and logs.

### 10. Database design playground

- **Existing:** `generator.ts` (tables, keys, mess), `SchemaFlow` (ER diagram), PGlite, `DataGeneratorPage`.
- **New:** `pages/SchemaDesignerPage.tsx`: edit tables, columns, types, PK, FK and constraints; ER view updates live; "Create in database" runs the DDL in an isolated PGlite instance to prove it is valid; normalization exercises (1NF to 3NF) with checkers based on declared functional dependencies; relationship exercises (1:1, 1:N, N:M); indexing explanations with an EXPLAIN comparison on a sample table.
- **Database:** none. Dependencies: framework.
- **Risks:** exercise checkers must be exact. Limit to well-defined cases.
- **Complexity:** high.
- **Tests:** DDL generation tests, exercise checker tests with accepted and rejected designs, ER rendering smoke.
- **Acceptance:** each listed concept has at least one exercise that is checked deterministically.

### 11. Data quality lab guided exercises

- **Existing:** `dataQuality.ts`, `DataQualityPage`, `generator.ts` messy presets, `python-data-cleaning` project.
- **New:** guided exercises per dimension (completeness, accuracy, consistency, uniqueness, validity) on deliberately imperfect datasets, solved with SQL or Python, with before and after score comparison and a data profile view.
- **Database:** none now; syncing run history uses the existing `data_quality_runs` table (migration 003, not yet wired).
- **Dependencies:** none new. **Risks:** exercises need verified solutions; reuse the project-task validation pattern.
- **Complexity:** medium.
- **Tests:** every exercise's reference solution passes and its starter fails (same pattern as project tasks).
- **Acceptance:** each of the five dimensions has guided exercises with scored before and after results.

### 15. Data engineering scenario challenges

- **Existing:** `scenarios.ts` and 16 SQL scenarios, projects, `DebugLab`, `tasks.ts`.
- **New:** content only plus small datasets: batch ETL, large CSV processing, duplicate transactions, incremental loading, late-arriving records, validation, retry logic, idempotent pipeline, failed batch handling, source-target reconciliation. Each has context, requirements, inputs, expected output, constraints, evaluation criteria and an explanation, validated by the same task runner.
- **Database:** none. Dependencies: framework helpful, not required.
- **Risks:** content quality and size. Keep datasets small.
- **Complexity:** high (writing and verifying).
- **Tests:** content validation tests identical in spirit to `siteTasks.test.ts`.
- **Acceptance:** ten scenarios, each passing its reference solution and failing its starter in CI.

## 8. First recommended phase

**Phase 1 (stability), in this order: S1, S2, S4, then S3.**

Why this order: S1 is cheap and protects every later change, S2 gives visibility while the rest is built, S4 removes a user-visible inconsistency, and S3 depends on a decision from you about where to test. Phase 2 then starts with the Mistake Notebook, which several later items consume.

## 9. Decisions needed from you

1. **Supabase testing:** a separate free Supabase project (recommended), a local Docker stack, or production with test accounts that I delete afterwards.
2. **Merge and deploy flow:** the fix branch is unmerged while production already runs it. Merge it first, so `main` matches production, before Phase 1 starts.
3. **Mastery labels:** keep the Analytics labels (Strong, Developing, Needs practice) or the Progress labels (Learning to Mastered) as the single vocabulary.
4. **New dev dependencies for S1:** ESLint and Playwright test runner (both free, dev only).

## 10. Implementation status

Updated at the end of implementation. Branch `feature/dataforge-evolution`, not pushed, not merged, not deployed.

| ID | Item | Status | Where | Verified by |
|---|---|---|---|---|
| S1 | Regression guards | Done | `scripts/check-prerender.mjs`, `eslint.config.js`, `e2e/`, CI steps | Guard fails on a bad page; lint clean; browser suite |
| S2 | Persistent error log | Done | `lib/diagnostics.ts`, `/debug` | 7 unit tests, browser test |
| S3 | Supabase live verification | **Not run** | `docs/SUPABASE_TEST_PLAN.md`, `e2e/sync.spec.ts` (skipped) | Needs a safe Supabase project; merge logic is unit-tested only |
| S4 | One mastery scorer | Done | `lib/solveAnalytics.ts`, Progress page | Equivalence test |
| 5 | Mistake notebook | Done | `/mistakes`, `lib/mistakes.ts` | 15 tests, browser flow |
| 7 | Revision v2 | Done | `lib/revision.ts`, `/review` | 12 tests |
| 8 | Insights and recommendations | Done | `lib/learningInsights.ts`, `/analytics` | 13 tests |
| 6 | SQL review panel | Done | `lib/sqlReview.ts`, `SqlReviewPanel` | 10 tests incl. real PostgreSQL, browser flow |
| 13 | Interview mode v2 | Done | `lib/mockReport.ts`, `/mock-interview` | 5 tests, browser flow. Hidden test cases are not added; grading is by result rows |
| 14 | Python assessment polish | Done | `lib/pyAssessment.ts` | 7 tests, browser flow with a real timeout |
| 16 | GitHub scope | Done | `lib/portfolioExport.ts` | 3 tests. A real GitHub connect was not tested |
| 17 | Resume generator | Done | `lib/resume.ts`, `/portfolio` | 10 tests, real project content |
| 18 | Planner v2 | Done | `lib/plannerWeek.ts`, `/career/planner` | 12 tests, browser flow |
| 9 | ETL builder | Done | `/etl-builder`, `lib/lab/etl.ts` | 21 tests, browser flow |
| 12 | DAG simulator | Done | `/dag-simulator`, `lib/lab/dag.ts` | 14 tests, browser flow |
| 10 | Database design playground | Done | `/schema-designer`, `lib/lab/schemaDesign.ts` | 23 tests incl. real PostgreSQL, browser flow |
| 11 | Data quality guided exercises | Done | `/dq-exercises` | Every solution run on PostgreSQL or CPython |
| 15 | Data engineering scenarios | Done | `/de-scenarios` | Every solution run on PostgreSQL or CPython |

Known gaps: S3; Python exercises in the two guided labs were validated in CPython but not driven through the browser editor; the original `/data-quality` lab does not link to the new exercises except from the menu.
