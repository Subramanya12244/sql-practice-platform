# DataForge Visual Learning Engine: architecture and plan

Branch: `feature/visual-learning-engine` from `origin/main` `60f29ca` (production baseline: Worker `dataforge`, deployed from `main`). Nothing here is pushed or deployed.

## Phase 0 findings (what exists and is reused)

- **SQL Query Visualizer** (`lib/visualize.ts`, `components/VizView.tsx`, `pages/QueryVisualizerPage.tsx`, embedded in `QuestionPage` "Visualize query"): logical stages (FROM/JOIN, WHERE, GROUP BY, HAVING, window, SELECT, DISTINCT, ORDER BY, LIMIT) with real rows from derived queries, join match/unmatched counts, EXPLAIN / EXPLAIN ANALYZE plan tree, structure and flow diagrams, provenance badges (`executed`, `parsed`, `plan`, `estimated`). It only had Previous/Next. It is extended, not duplicated.
- **Execution**: PGlite via `lib/browserDb.ts` (`runQuery`, `submitQuery`); Pyodide via `lib/pyRunner.ts` + `pyodide.worker.ts` (loads numpy/pandas from imports, blocks network/js bridges, 10 s limit, stdout capture).
- **Charts**: Recharts 2.15 is already a dependency.
- **Daily Learning**: `LessonUi.tsx` (`ExampleRunner`, `GradedExercise`), progress in `Progress.daily`, mistakes via `recordMistake`, study time via `StudyTimer`. Left untouched in behaviour.

## Design

Execution data is separated from presentation. Every visualizer produces a list of **frames** and a **provenance**; one shared player shows them.

| Layer | Files | Role |
| --- | --- | --- |
| Frames + player | `lib/visual/playback.ts`, `components/visual/Playback.tsx` | Pure playback state (play, pause, next, prev, restart, speed, scrub), keyboard, `VisualShell` layout, provenance badge |
| Python trace | `lib/visual/pyTrace.ts` | Real `sys.settrace` run inside the existing Pyodide worker: line, locals, call stack, returns, exceptions, stdout. Capped steps and value size. Conceptual memory model derived from it |
| Data (pandas/numpy) | same tracer, DataFrame/ndarray snapshots | Before/after tables, changed cells, shape, dtypes, NaN counts |
| API Studio | `lib/visual/apiSim.ts` | Deterministic mock server and client: status scenarios, rate limit, Retry-After, backoff, pagination, idempotency. No network |
| ETL | `lib/visual/etlSim.ts` | Deterministic pipeline simulator with injectable failures |
| Charts | `lib/visual/chartData.ts` | Fixture data, aggregation, chart advice (misleading-chart checks) |
| Explain | `lib/visual/explain.ts` | Progressive explanation (concept, hint, visual, detailed, full) from the learner's code and results |
| Daily | `lib/visual/dailyVisual.ts` | Maps a lesson (topics, kind) to a visualizer; no lesson file is edited |

## Honesty labels

- **Executed**: real runtime data (SQL rows, Python trace).
- **Parsed / Plan / Estimated**: existing SQL labels kept.
- **Conceptual**: the memory model and complexity notes are an educational model, not CPython internals or hardware timing.
- **Simulated**: API and ETL are deterministic simulations, never real requests.

## Milestones

1. Shared player + SQL Cinema (playback on the existing visualizer).
2. Python Code Time Machine.
3. Pandas / NumPy Visual Studio.
4. API Request Studio.
5. ETL Pipeline Playback.
6. Data Visualization Explorer.
7. Explain visually + Daily Learning integration; hub page and navigation.

After each: tests, regression check, changed-file list in `VISUAL_LEARNING_REPORT.md`.

## Constraints kept

No new paid dependency, no server-side execution, no arbitrary requests, learner code is never stored in the explanation layer, existing grading and the 270 lessons are not changed.

## V2: resolving the V1 limitations

Eleven phases, built on the same shared player and honesty labels. Results and the limitation-by-limitation matrix are in `VISUAL_LEARNING_REPORT.md` (section "V2").

| Phase | Plan | Evidence |
| --- | --- | --- |
| 1 Trace scalability | Configurable limits, loop sampling, checkpoints, paging, gap rows, exact counts, event/time budget; collection never changes the program | `siteVisualTraceScale`, `siteVisualPyTrace`, browser scale tests |
| 2 SQL set operations | Parser-backed UNION / INTERSECT / EXCEPT (and ALL) stages on real data | `siteVisualSetOps`, Query Cinema e2e |
| 3 SQL row animation | Real `ctid` identity where it exists, labelled trace identity otherwise, reduced-motion aware | `siteVisualRowFlow`, reduced-motion e2e |
| 4 Tree and Graph | Real algorithm traces with queue/stack and playback | `siteVisualTree`, `siteVisualGraph` |
| 5 Coverage | An aid for all 270 lessons, generated report, no bulk lesson edits | `siteVisualCoverage`, `VISUAL_LEARNING_COVERAGE.md` |
| 6 Help | One `VisualHelp` mechanism on every visual page, plus the DataForge Guide sections for the visual tools | `siteVisualHelp`, `siteHelp*` |
| 7 Equivalence | Plain run vs traced run: output, errors, exit, globals, grading | `siteVisualEquivalence*` |
| 8 Browsers | Chromium, Firefox, WebKit Playwright projects, unverified engines reported | `VISUAL_BROWSER_MATRIX.md` |
| 9 Supabase | Unit-level sync tests; live tests prepared and gated on a staging project | `siteSupabaseSync*` |
| 10 Release validation | tsc, ESLint, Vitest, build, prerender, sitemap, Playwright | report, "Release validation" |
| 11 Documentation | This plan, the report and the matrix | these files |

Rules kept: no new dependency, no network or server execution for learner code, nothing simulated is presented as real, existing grading and the 270 lessons are unchanged.
