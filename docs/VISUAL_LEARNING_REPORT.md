# Visual Learning Engine: delivery report

Branch `feature/visual-learning-engine` (from `origin/main` `60f29ca`). Working-tree changes only: nothing is committed, pushed, merged or deployed. Plan: `VISUAL_LEARNING_PLAN.md`.

## What was built, by phase

| Phase | Result | Real or modelled |
| --- | --- | --- |
| 1 SQL Query Cinema | The existing visualizer gets the shared player (play, pause, step, restart, speed, scrubber, keyboard) on the logical stages; a plain-language "What is this?" for plan nodes (Seq/Index Scan, Nested Loop, Hash/Merge Join, Sort, Aggregate and more; unknown nodes get no text); a "Compare two queries" tool (output equality, rows per logical step, operations, plan cost, median time); presets for CTE, UNION, CASE/NULL and subquery. Existing stages, rows removed/retained, join match counts, EXPLAIN and EXPLAIN ANALYZE are unchanged. | Executed rows; plan from PostgreSQL's EXPLAIN (labelled estimated) |
| 2 Python Code Time Machine | `sys.settrace` run inside the existing Pyodide worker: current line, variables and changes, call stack, return values, exceptions with the state before, generators (lazy yields), recursion, lists, tuples, dicts, sets, strings, deque, linked objects. Loop counts and per-line run counts. | Trace is real (executed). Memory model and growth notes are labelled conceptual / estimated |
| 3 Pandas and NumPy Studio | Same tracer snapshots DataFrames, Series and arrays (shape, dtype, index, missing counts), shows before/after grids with changed cells highlighted and a sentence on what changed. Presets: filter, sort, groupby, merge, missing values, dtype conversion, pivot/melt, duplicates, concat, broadcasting, masks, slicing, reshaping, axis aggregation. | Executed |
| 4 API Studio | Deterministic mock server and client on a virtual clock: 200, 201, 400, 401, 403, 404, 429, 500, timeout, offset and cursor pagination, Retry-After, exponential backoff, idempotency keys. Learners change settings but cannot enter URLs. | Simulated |
| 5 ETL Playback | SOURCE → EXTRACT → VALIDATE → TRANSFORM → LOAD → TARGET with row counts, rejects, retries, checkpoint, virtual duration; full and incremental (watermark), dedupe, upsert versus append, quarantine, dead-letter queue, injected failures, SCD type 2, CDC, task dependencies. | Simulated |
| 6 Chart Explorer | Bar, line, time series, scatter, histogram, box, pie, heatmap over a fixed 144-row fixture; dimension, measure, aggregation, filters, bins, zero baseline; written rules for when a chart misleads; the numbers behind every chart. | Fixture data |
| 7 Universal explanation | "Explain visually", "Why did this output happen?", "Show the common mistake", another similar challenge, five progressive levels (concept, first hint, visual, detailed execution, full solution). Built from the learner's code and real run; the solution appears only at its own level. No AI service. | Rule-based |
| 8 Daily Learning | Opt-in "Watch it run" under every runnable example and "Explain visually" under every graded exercise; a "Visual helper" link per lesson chosen from the lesson's own title and topics. No lesson file edited. 216 of 270 lessons get a helper (python 41, sql 53, data 38, api 22, etl 36, chart 26). The other 54 (Excel, Linux, Git, statistics, business analytics, interviews and similar) have no fitting visualizer and get none. | |
| 9 UI | One shared shell and player; new pages `/visual`, `/visual/python`, `/visual/data`, `/visual/api`, `/visual/etl`, `/visual/charts`; "Visual learning" in the Intelligence menu. Stacks on small screens; no horizontal scroll (tested). | |
| Python practice and SQL question pages | Python exercises get an "Explain your solution" box that traces the latest run (editable, so a function call can be added). SQL questions get the Explain panel in the Visualize tab. | |

## Honesty rules kept

Each view carries a badge: Executed, Parsed, Plan, Estimated, Conceptual model, or Simulated. Complexity text says "step counts and code shape, not timings". The memory view says it is not CPython's real memory layout. API and ETL say they are simulations. Plan nodes are explained only for known types.

## Limits

- Trace cap: 400 steps (reported when hit; the program still ran to the end). Values are trimmed (12 items, 8 by 8 array window, 10 DataFrame rows).
- Tracing is single-file. Exercises written as functions need a call added in the box to be watched.
- Set operators (UNION and the like) still show through the existing Structure tab, not as logical stages, because the existing parser does not support them as one SELECT.
- The Query Cinema, and SQL "Watch it run" links, use the Northwind sample database; a lesson query for another dataset may not run there.
- Python tracing in the browser depends on Pyodide's `sys.settrace` support; it was verified (below) but only in Chromium.
- Not done: a per-line animation of rows moving between SQL stages; trees and graphs have no dedicated drawing (they render as nested objects); the visual data for pie/box/heatmap uses the fixture only.

## Verification

| Check | Result |
| --- | --- |
| `tsc --noEmit`, ESLint (whole project) | clean |
| New unit tests | `siteVisualEngines` 45, `siteVisualUi` 16, `siteVisualPyTrace` 23 (tracer run in real CPython 3.13 for loops, functions, aliasing, shallow/deep copy, list/dict/set/tuple, recursion, generators, exceptions, syntax errors, linked list, step cap, pandas, NumPy broadcasting and masks) |
| Full Vitest (`TZ=UTC`, as CI runs) | 76 files, 5661 passed, 2 skipped, 0 failed. Existing Daily, Mistake Notebook, study-time and grading tests pass with the new panels mounted (they render the lesson exercises that now contain the opt-in visual block) |
| Build and prerender | 946 pages (was 940), `check:prerender` clean, 6 new sitemap URLs |
| New e2e (`visual.spec.ts`), desktop and mobile | 12 passed. Includes real Pyodide traces (aliasing and memory model, exception with its type, pandas with highlighted tables), keyboard control, no horizontal scroll, API/ETL/chart interaction, Query Cinema playback |
| Existing e2e (smoke, daily, daily-study, guided-labs), desktop and mobile | 50 passed |

Not run: `sync.spec.ts` (needs Supabase), live production checks, Firefox/Safari.

## Changed files

Modified: `components/PlanTree.tsx`, `components/VizView.tsx`, `components/daily/LessonUi.tsx`, `lib/navigation.ts`, `pages/DailyPages.tsx`, `pages/PythonPracticePages.tsx`, `pages/QueryVisualizerPage.tsx`, `pages/QuestionPage.tsx`, `routes.tsx` (all under `frontend/src/site/`).
Added: `lib/visual/{playback,pyTrace,dataDiff,apiSim,etlSim,chartData,explain,dailyVisual,planExplain,stageCompare}.ts`, `components/visual/{Playback,PythonTimeMachine,ApiStudio,EtlPlayback,ChartExplorer,ExplainPanel,LessonVisual,PyExplainBox,QueryCompare}.tsx`, `pages/VisualPages.tsx`, three test files, `e2e/visual.spec.ts`, and the plan and this report.

## Release

Not requested. A commit, push, PR and deploy each need your separate approval; a merge to `main` deploys automatically.

---

# V2: resolving the V1 limitations

Branch `feature/visual-learning-engine`, still uncommitted. Nothing was committed, pushed, merged or deployed. Status values below are only "resolved" where a test or a real-browser run shows it; everything else says what is left.

## Limitation and validation matrix

| # | V1 limitation | What was done | Main files (under `frontend/src/site/` unless noted) | Tests added | Result | Still restricted |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | Trace capped at 400 steps | Configurable limits. Long loops keep the first 10 and last 10 iterations plus every 1,000th as a checkpoint, with summaries and gap rows. Line, call and depth counts stay exact. First, last, deepest-stack and exception steps are always kept. A budget of 400,000 events or 5 s stops recording (`settrace(None)`) and the program runs on. Step list is paged, with jump buttons and a "this trace is sampled" notice. Trace wire format is delta-encoded. The worker no longer caps the trace result line at 20,000 characters. | `lib/visual/pyTrace.ts`, `lib/visual/traceStore.ts`, `components/visual/PythonTimeMachine.tsx`, `lib/pyodide.worker.ts` | `siteVisualTraceScale` 54, `siteVisualPyTrace` 23 (was 23, extended); e2e "Scale (browser)" 10,000 and 200,000 iterations | Passed. Real Pyodide on Chromium and Firefox: the program finishes with the right output, the notice shows, counts are shown. | Steps inside a gap do not exist in the view. Exact counting is about 25 to 35 times slower than an untraced run in CPython. When the time budget ends tracing early the counts are lower bounds (shown as `≥×N`). On Firefox the 200,000-iteration loop stopped at about 116,000. Tracing remains single-file. |
| 2 | UNION and the like had no stages | A reader with PostgreSQL precedence for UNION, UNION ALL, INTERSECT, INTERSECT ALL, EXCEPT, EXCEPT ALL (including nesting and parentheses). Each branch runs for real. A set-operation stage shows both inputs, matches, removed rows and the result. | `lib/sqlClauses.ts`, `lib/sqlAst.ts`, `lib/visualize.ts`, `lib/visual/setOps.ts`, `components/visual/SetOpView.tsx` | `siteVisualSetOps` 37; `siteVisualize.test.ts` updated (its "unsupported" case now uses a query that is still unsupported); e2e "UNION (set operator)" | Passed on Chromium, Firefox, WebKit. | Runs on the Northwind sample database, so a lesson query for another dataset may not run. Queries the reader cannot parse still fall back to the Structure tab. |
| 3 | No row animation between SQL stages | FLIP-style movement of rows between stages. Identity is the real `ctid` where the row is a base-table row; otherwise a labelled trace identity. Animation never alters the executed query. Static when reduced motion is on (OS setting or the in-page toggle). | `lib/visual/rowFlow.ts`, `lib/visual/rowTrace.ts`, `components/visual/RowFlow.tsx`, `components/visual/MotionToggle.tsx`, `components/VizView.tsx` | `siteVisualRowFlow` 28 (node) + 10 (component); e2e "Reduced motion" | Passed in all engines. | Rows shown are a sample of each stage, not every row. Derived rows (aggregates, joins) use a labelled trace identity, not a database identity. A guard for volatile functions exists in `rowTrace.ts`. |
| 4 | Trees and graphs had no drawing | Tree Explorer (build a BST or plain binary tree from a level-order list of up to 31 nodes; insert, search, delete with the three delete cases, the four traversals recursive or iterative, height and balance analysis, a degenerate-tree demo) and Graph Explorer (BFS, DFS explicit-stack and recursive, fewest-edges path, Dijkstra, Bellman-Ford with negative-cycle detection, cycle detection, connected components, Tarjan SCC, Kahn topological sort) driven by real algorithm traces, with queue/stack panels and the shared player. 8 presets each. | `lib/visual/tree.ts`, `lib/visual/graph.ts`, `components/visual/TreeExplorer.tsx`, `components/visual/GraphExplorer.tsx` | `siteVisualTree` 53 + 22, `siteVisualGraph` 35 + 19 | Passed. | The curriculum has no tree lesson (0 of 270 map to it). The Python Time Machine still draws linked structures as nested objects; reusing `TreeDiagram`/`GraphDiagram` there was not done. |
| 5 | Not every lesson had a visual aid | 270 of 270 lessons map to an aid (14 aids, 8 new pages: Tree, Graph, Excel, Linux, Git, Statistics, Business, Interview). Coverage is generated, not hand-written. | `lib/visual/dailyVisual.ts`, `scripts/visual-coverage.mjs`, `docs/VISUAL_LEARNING_COVERAGE.md`; labs `ExcelLab`, `LinuxLab`, `GitLab`, `StatsLab`, `BusinessLab`, `InterviewLab` with `lib/visual/{excel,linux,git,stats,business,interview}.ts` | `siteVisualCoverage` 21; engine + UI tests: Excel 69+23, Linux 71+19, Git 67+17, Interview 46+13, Stats 51+16, Business 36+15 | Passed. | 87 lessons get a generic or partial fit (each listed with what is not covered). 14 Power BI lessons have no dedicated aid. 51 lessons open the aid on a matching preset. The six V1 aids ignore `?preset=`. Interview has no presets. Excel (62 functions), Linux and Git are limited models and list what they do not support. Lesson files were not edited. |
| 6 | No help inside the tools | One `VisualHelp` block on every visual page and on the SQL visualizer, reading `HELP[id]` (14 entries). It explains what the view shows, what is real, controls and limits. | `components/visual/VisualHelp.tsx`, `lib/visual/helpContent.ts`, `pages/VisualPages.tsx`, `pages/QueryVisualizerPage.tsx` | `siteVisualHelp` 77 | Passed. | Help for Linux, Git and Interview was written before those screens existed and was not re-read against the final controls. The existing Daily Learning guide only holds concept articles, so it was not reused. |
| 7 | Visual mode might change what a program does | Equivalence suites compare a plain run with a traced run: stdout, stderr, exit status, exception type and message, and the final value of every learner global. SQL: `visualize()` rows and counts, database unchanged, grading verdict identical. UI: verdicts, progress, mistakes and study time identical whether the block is opened or not. Differences found were fixed (see the list below). | `lib/visual/pyTrace.ts`, `lib/pyodide.worker.ts` (trace line), tests | `siteVisualEquivalencePython` 145, `siteVisualEquivalenceSql` 34, `siteVisualEquivalenceUi` 2, browser tests 3 | Passed: 43 hand-written, 343 curriculum programs from 60 lessons, 17 pandas/NumPy programs, 22 SQL queries. Run in real CPython 3.14.6 (Pyodide is 3.13; the scale suite also ran on 3.13.9) and, for three cases, in real Pyodide. | `sys.stdout` is replaced by a capture object while tracing (a global that holds it sees a different type). `if __name__ == "__main__":` does not run in either mode (the worker's plain run has no `__name__`), unchanged to protect existing grading, and a product decision is open. `browserDb.submitQuery` needs a Worker and was not called; the function under it was. |
| 8 | Only Chromium checked | Playwright projects for Firefox and WebKit (opt-in with `E2E_ENGINES`), desktop and mobile profiles. 33 visual tests run per project. | `playwright.config.ts`, `e2e/visual.spec.ts`, `e2e/visual-engines.spec.ts`, `docs/VISUAL_BROWSER_MATRIX.md` | 25 new e2e tests, plus 2 scale tests added in V2, plus the 6 V1 tests, each in 6 projects | See the engine table and notes below. | Chromium is system Chrome 157, not bundled Chromium. WebKit 18.2 is not Safari. `firefox-mobile` is a 390×844 touch viewport only. No real phone or Safari was tested. |
| 9 | Supabase sync unverified | Unit-level merge laws and a two-device offline/reconnect simulation against an in-memory fake Supabase. A live test is written but gated. One real defect fixed. | `lib/auth.tsx`, tests | `siteSupabaseSyncMerge` 32, `siteSupabaseSyncApp` 5, `siteSupabaseSyncLive` 9 (6 gated, skipped) | Unit level passed. **Live sync not verified.** | No staging project exists, so sign-up, login, session restore, RLS, triggers and real reconnect were not run and no production account was used. Needs: a separate staging project with migrations 001 to 012, "Confirm email" off, `SUPABASE_STAGING_URL` and `SUPABASE_STAGING_ANON_KEY` (anon key only; the test refuses a service-role key or the production URL). Visual V2 itself syncs nothing (two localStorage preferences). |

### Defects found by the V2 checks, and fixed

- Tracer: `$$ $& $' $\`` in learner source corrupted the generated program (lesson e120 broke). A learner `__repr__` with side effects ran under trace. `__del__`, weakref and `getrefcount` differed. `sys.stdout` lacked `encoding`, `name`, `mode`, `reconfigure`, `buffer`. A slots class with a logging `__getattr__` was asked for `__dict__`. All fixed and pinned by strict equivalence tests.
- Browser (real Pyodide): `__name__` and the pre-imported `sys` differed between plain and traced runs. The tracer now builds the same namespace under Pyodide. The two Playwright tests that documented this with `test.fail` now pass as normal tests.
- Python 3.13 yield detection in the tracer (it only worked on 3.14).
- `auth.tsx` `startSync`: if reading the account failed but writing worked, this device's state overwrote the account. It now stops and keeps progress local. A missing profile row (PGRST116) is still treated as an empty account.
- Existing test `siteVisualize.test.ts` expected set operations to be unsupported; updated.

### Release validation (2026-11-12, `TZ=UTC`)

| Check | Result |
| --- | --- |
| `tsc --noEmit` | clean |
| ESLint (`eslint src`) | clean |
| Full Vitest | 104 files, 6,680 passed, 8 skipped, 1 failed on the first full run: a 12-process CPython test hit the 5 s default timeout under load. It passes alone; it now has a 120 s timeout. The full suite was **not** re-run after that one-line change. The 8 skipped include the 6 live-Supabase tests; the other 2 were not identified. |
| `build:site`, `check:prerender` | 954 pages (V1: 946, +8 new `/visual/*` routes), no failed Suspense boundaries. Sitemap: 931 unique URLs, all 14 `/visual/*` routes present. |
| Playwright, Chromium (system Chrome), desktop and mobile | no failures in smoke, daily, daily-study, guided-labs, visual, visual-engines |
| Playwright, Firefox 132 and WebKit 18.2, desktop and mobile | all visual specs pass. Failures in older specs are listed under "Cross-browser" below. |
| Supabase live | not run (no staging) |
