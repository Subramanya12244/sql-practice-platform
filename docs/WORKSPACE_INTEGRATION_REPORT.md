# Unified Exercise Workspace: integration report

## Overview (coordinator, 2026-11-18)

Phase 2 made the shared workspace the exercise experience across DataForge instead of a route beside the old systems. Five workers had exclusive file ownership (`WORKSPACE_COORDINATION.md`, "Phase 2"); the coordinator owned the shared contracts, route, progress ports, panels and the regression.

| Area | Result |
| --- | --- |
| SQL correctness and safety | Q19 graded against the right query; six more questions with provably wrong reference columns or rows fixed; parser-based read-only policy enforced in the adapter and in `lib/sqlRunner` (see `WORKSPACE_SQL_SAFETY.md`). The SQL question page now runs under the policy of its own reference query. |
| Daily Learning | Graded Python, pandas, NumPy and SQL exercises render in the embedded workspace; the lesson store receives identical writes through shared functions (parity tests). Written exercises and local examples are unchanged. |
| `/visual/data` and Python views | Runs on the shared Pandas and NumPy adapters; old `?preset=` ids still resolve; the old trace viewer shares the new step, branch, diagnosis and limitation panels. Pyodide traceback frames are all named `<exec>` with no source text; line recovery was fixed accordingly. |
| Learn hub and Projects Lab | Real exercises linked from 149 of 178 topics, 40 of 61 project tasks and 14 of 16 scenarios. No fake ids; progress is read-only. |
| Content | 17 Daily hints that gave away the answer replaced; 118 exercises enriched (hints 1 to 4, debugging notes, validated alternatives). 93.9% of graded exercises are not enriched. |

Coordinator decisions and fixes: contracts and the hint-level mapping in `WORKSPACE_ARCHITECTURE.md`; the default progress port routes Daily exercises to the Daily port; the Daily solution confirm text no longer says it counts as solved; a hydration mismatch on `/workspace?e=...` and `/visual/data?preset=...` found only on the prerendered build and fixed (see `WORKSPACE_REGRESSION_REPORT.md`); Guide help text for the data page updated.


The coordinator finalises this file. Sections are written by the worker who owns them.

## Learn hub and Projects Lab integration (Phase 2, Agent 4)

### What was added

- `lib/workspaceLinks.ts` (new): the one place that decides which real exercise the workspace opens from a Learn hub topic, a Projects Lab task or a scenario. It also reads status from the existing stores (read only) and finds the next unsolved exercise on a path.
- `lib/workspaceLinksData.ts` (new, generated): Daily exercises per topic. A test rewrites it from the lesson files (`WORKSPACE_LINKS_WRITE=1 npx vitest run src/test/siteWorkspaceLinks.test.ts`) and fails when it is stale.
- `components/learn/WorkspacePractice.tsx` (new): `WorkspacePracticeBlock` (topic pages), `LinkedExerciseList` (project tasks, scenarios), `PathWorkspaceStep` (path pages), `NextQuestionLink` (topic and question list pages), `usePracticeState` (progress hook).
- Wired into `pages/LearnHubPages.tsx` (topic block after the existing "Practice" section, path step inside "Practical exercises"), `pages/ProjectsPages.tsx` (inside each linked sql or python task), `pages/ScenarioPages.tsx`, `pages/TopicPage.tsx`, `pages/QuestionsPage.tsx`. `lib/learnTopics.ts` `buildBundle` gained an additive `workspace` field. `pages/QuestionPage.tsx` was not changed: its phase 1 header "Open in workspace" link stays.
- No route, no store, no completion rule, no adapter and no content file changed. `lib/projects*.ts` was read, not edited: completion is `projectStatus` over `ProjectProgress.tasks[id].passed`, written only by a task's own Check; the new UI never calls it.

### Rules

- Real ids only. Every id loads through `workspace/sources` `loadExerciseById`, has a domain in sql/python/pandas/numpy, equals the domain `dailyVisual.exerciseWorkspaceDomain` gives, and passes `exerciseProblems`. A test checks all of it, and that the stored titles match the exercises.
- Progress is truthful. Solved comes from `progress.questions[n].solvedAt` (SQL), `progress.lessons["py:slug"]` (Python), `progress.daily.days[d].passed` (Daily). Attempted comes from `questions[n].attempts`, Python stats (`sqlp.py.stats`) and `daily.days[d].attempted`. Nothing is written. Opening a link writes nothing (browser test compares the stores before and after).
- Hydration: the block renders the empty snapshot on the server and on the first client render (`useSyncExternalStore` with an empty server snapshot, as `useProgress` does), then real states. The "N of M solved" count appears only after mount.

### Learn hub: how a topic gets exercises (derived, no hand-picked ids)

For each of the 178 topics (167 notes and 11 analytics modules) candidates come from:

1. SQL questions the note links (`note.questions`) as `sql:<slug>`, difficulty from the question index.
2. Python problems whose `topic` equals the note slug, as `py:<slug>`.
3. Daily Learning exercises of the lessons whose own `links.notes` names the note (a module uses the lessons of its phase): the first graded guided exercise of each such lesson, spread to at most 2, then the first graded independent exercise, spread to at most 2. Guided is shown as Easy and independent as Medium (the workspace's own convention). Written exercises are never linked.

`pickPractice` then takes up to 5, going round the three kinds, taking from each kind a spread from easiest to hardest, and orders the result by difficulty. Same input gives the same output (tested).

| | Topics |
| --- | --- |
| Topics with at least one workspace exercise | 149 of 178 |
| of which have SQL questions | 65 |
| of which have Python problems | 19 |
| Topics with Daily exercises only | 65 |
| Topics with none (no block, existing empty state kept) | 29 |

The 29 with none are all data engineering notes with no graded exercise anywhere: 4 Spark notes (distributed-computing, caching, driver-executors, rdd), 2 Airflow notes (connections, variables), 10 dbt notes and 13 cloud notes. The audit does not invent practice for them.

Path pages: each of the four paths shows "Next exercise to solve in the workspace": the first exercise, in lesson order, of the first lesson not completed that the learner has not passed (`nextWorkspaceStep`). Completed lessons are skipped. A new learner sees the first exercise of the first lesson. The SQL path's free 18-lesson course exercises are not workspace sources (they are `lesson-slug#n` records), so they are not linked.

### Projects Lab: reviewed table (`PROJECT_TASK_EXERCISES`)

40 of the 61 sql and python tasks (12 projects) have a linked exercise, each with a one-line reason. Checklist and decision tasks (all of them) are never linked, by design. Each linked task shows "Open a practice exercise" (collapsed) with up to 3 exercises, their reason, domain and real status. Per project:

| Project | linked / sql+python tasks | Deliberately not linked |
| --- | --- | --- |
| airflow-etl-pipeline | 3 / 5 | idempotent-partition, backfill-month (delete-then-insert partition load: no exercise teaches it; the upsert exercises use a different technique) |
| csv-to-postgres-etl | 4 / 5 | stage-orders (create and fill a typed table: no matching exercise) |
| data-validation-pipeline | 5 / 5 | |
| dbt-analytics-project | 2 / 5 | staging-models, fct-orders, check-snapshot (dbt specific) |
| end-to-end-pipeline | 4 / 5 | bronze-silver |
| hr-analytics-warehouse | 1 / 5 | dim-department, dim-employee, fact-salary-change, attrition-rate |
| incremental-loading | 4 / 5 | initial-load |
| pyspark-transformation | 3 / 4 | partition-skew |
| python-data-cleaning | 5 / 5 | |
| rest-api-to-postgres | 4 / 6 | land-raw-json, parse-jsonb (JSONB: no exercise) |
| sales-analytics-pipeline | 3 / 5 | fact-order-lines, rep-attainment |
| star-schema-warehouse | 2 / 6 | dim-product, dim-customer-initial, scd2-change, fact-sales |

Partial matches are stated in the reason (for example `csv-to-postgres-etl/parameterised-insert` links `py:batch-records-for-load`, which covers only the batching half; `dbt-analytics-project/ref-graph` links `py:topological-sort`, which covers the build-order half). A Python task is not linked to a SQL exercise or the reverse (`star-schema-warehouse/scd2-change` is SQL and the only SCD2 exercise is Python).

### Scenarios: reviewed table (`SCENARIO_EXERCISES`)

14 of 16 scenarios link to a real Northwind question or Daily exercise ("Practise the concept first", collapsed). Not linked: declining-customers, quota-attainment (no exercise teaches comparing per-customer yearly totals or target versus actual with empty quarters). A scenario runs on its own dataset and is graded by its own panel; the link only opens a different exercise, so it does not reveal the scenario's solution.

### Question and topic pages

`pages/TopicPage.tsx` (`/topics/:slug`) and `pages/QuestionsPage.tsx` (`/questions`) show "Practise the next unsolved question in the workspace" (the first unsolved question of the topic or list, or the first one once all are solved). The header "Open in workspace" on `/questions/:slug` is unchanged.

### Tests

`siteWorkspaceLinks.test.ts` (22: generated table in sync and deterministic, ids and domains, titles, project and scenario keys, pick logic, state logic, every topic bundle), `siteWorkspaceLinksUi.test.tsx` (10: empty server snapshot, link format, progress states, nothing written on click, project record unchanged), `siteWorkspaceLinksPages.test.ts` (8: server-rendered pages), and `e2e/workspace-discovery.spec.ts` (desktop and phone).

### Findings and limitations

- Python library exercises always have domain `python` in the workspace converter, even those that import pandas (`py:pandas-groupby-agg`, `py:pandas-clean-dataframe`). Agent 3 owns the Python adapter; the Python adapter must be able to run pandas for those to work. Daily pandas exercises have domain `pandas`.
- The mapping is judgment where it is the reviewed table; every row carries its reason so a reviewer can disagree row by row.
- Daily exercise titles and the topic table are generated data (27 KB source, about 6 KB gzip) shipped with the client bundle because the topic loader also runs in the browser.
- Going back from the workspace to the page you came from relies on the browser Back button. A "Back to <page>" link needs a change in `pages/WorkspacePage.tsx` (see the interface request).

## Daily Learning inline integration (Phase 2, Agent 2)

The unified workspace is now the exercise experience inside Daily lessons. One source of truth: the workspace and the old in-page runner write the same store records through one set of functions, `lib/dailyExercise.ts` (`recordDailyCheck`, `trackDailyRun`, `saveDailyDraft`, `canRevealSolution`). `workspace/dailyPort.ts` is the workspace's `ProgressPort` for Daily; `components/daily/EmbeddedDailyExercise.tsx` is the lesson card around `EmbeddedExercise`.

### Daily integration audit

Counted from the 270 lesson files with `scripts` helpers and `lib/visual/dailyVisual.ts` (`exerciseWorkspaceDomain`); `dailyEmbedDecision` in `workspace/dailyPort.ts` applies the same rule the lesson uses.

| Measure | Count |
| --- | --- |
| Lessons | 270 (every one has graded exercises; none has only written work) |
| Lessons with more than one graded exercise | 270 (up to 7 exercises per lesson, at most 4 per step) |
| Lessons that also contain a written exercise | 166 |
| Exercises | 1,869: 1,059 guided, 810 independent (253 optional) |
| Graded, by workspace domain | 1,646: python 674, sql 387, pandas 522, numpy 63 |
| Written (self-assessed) | 223 |
| Python exercises that read `stdin` | 8 (d005, d007, d012; all plain Python) |
| Exercises importing scipy or statsmodels | 51 (44 + 7) in 11 lessons (d088 to d090, a102 to a105, a108, a112, a113, a169) |
| SQL exercises with their own setup (CREATE, INSERT, UPDATE, DELETE, DROP, ...) | 122 (116 multi-statement scripts, 6 single writes); 117 are multi-statement; 354 of 387 are `ordered` |
| SQL references with SET, REFRESH, or a write to a shared table | 12 (d044, d057 to d060, e150) |
| Lesson examples (not exercises) | 1,279 run in the browser, 71 `python local`, 45 `bash run` |

| What | Embedded? | Why |
| --- | --- | --- |
| Graded `python`, `pandas`, `numpy` exercises (1,259) incl. stdin and scipy/statsmodels | Yes | The Python and data adapters run them through the same worker (`runPython`, `loadPackagesFromImports` loads scipy and statsmodels) and grade with the same `sameOutput`. stdin is fed by the Python adapter. A pandas or NumPy exercise that reads stdin would stay in the in-page runner (the data adapter does not feed stdin); there are none. |
| Graded `sql` exercises (387), including own-table setup scripts and multi-statement answers | Yes, with a runtime gate | The SQL adapter derives each exercise's policy from its own reference script and grades with the same `submit`. When the workspace's safety checker would refuse the exercise's own reference (or fails to load), the card shows the in-page runner instead (`sqlWorkspaceRunnable`), so a learner never faces a workspace that cannot accept the answer. `siteWorkspaceDailyAdapters.test.ts` runs every reference through the adapter on real PGlite. |
| Written exercises (223) | No | Self-assessed against a rubric; nothing to run or grade in a browser engine. Unchanged (`WrittenExercise`). |
| `python local` (71) and `bash run` (45) examples | No | They are lesson examples, not exercises, and cannot run in the browser. Unchanged (`LocalExample`: code, verified output, "run on your computer"). |
| Browser-runnable examples (1,279) | Unchanged | `BrowserExample` keeps its own Run; examples never grade. |
| Any exercise whose engine cannot load | Falls back to the in-page runner | `EmbeddedDailyExercise` checks the adapter first. |

The in-page runner (`GradedExercise`) is kept for those fallbacks and as the reference the parity test compares against. It no longer shows an "Open in workspace" link (the workspace can run whatever it can run itself); the embedded card keeps one for the full-page workspace.

### State model

| Concern | Where it lives | Notes |
| --- | --- | --- |
| Exercise id | `daily:<day>#<exercise>` | Same ref as the Mistake Notebook; two exercises in a lesson have separate sessions. |
| Code and drafts | `Progress.daily.days[day].drafts[exercise]` | `useDraftSaver` + `saveDailyDraft`, 900 ms after typing stops, 6,000 characters. Reload restores the draft and opens the card. Reset saves the starter, like "Start over". |
| Pass | `recordDailyCheck(ok: true)` | `markMistakeSolved`, `updateDay` (attempted, passed, draft; counts for the daily goal), `completeExercise`. Only a graded Submit verdict can call it. Completion and mastery are computed by `lib/dailyProgress.ts`, untouched. |
| Fail | `recordDailyCheck(ok: false)` | `recordMistake` (graded, category only, never code) then `updateDay` (attempted). Python: "wrong-output" when the program ran, otherwise the exception's category. SQL: category from the engine error text and the lesson's topics. |
| Run | `trackDailyRun` | `python_executed` or `sql_executed` event only. |
| Submit | in `recordDailyCheck` | `python_submitted` or `sql_submitted` with `{ passed }`. |
| Hints | workspace ladder only | Nothing is stored (the in-page ladder never stored them). The card counts opened levels to apply the lesson's solution rule. |
| Solution | the card, not the workspace ladder | Unlocks after a pass, two checks that did not pass, or (guided) every hint, exactly as before; it never records anything. The embedded exercise has `solution.code` blanked so the workspace cannot reveal it. |
| Independent hints | none | The lesson says "No hints"; any hint a content layer adds is not shown on independent exercises. |
| Study timer | `StudyTimer`, lesson-level | Independent of the runner; unchanged. |

### Parity evidence

`siteWorkspaceDailyParity.test.tsx` renders the same exercise in the in-page runner (`legacy`) and in the embedded workspace with the same learner actions and compares the stored result: `Progress` (daily, mistakes, lessons, active days, day counts) after wrong, wrong, right; after a run then a wrong check; after a crash (NameError, filed under "names" by both). The activity events (`python_executed`, `python_submitted` with `passed`) are compared too. Opening, running, every hint, and visualizing leave no pass, no completion event and no mistake. Drafts, independent state of two exercises, the solution lock, written exercises, the runner fallbacks and the server render are covered in the same file.


## Python and data visualization integration (Phase 2, Agent 3)

### What was done
- `/visual/data` now runs the learner's code through the shared data adapter (`workspace/adapters/data`, same Pyodide worker, no second engine) and renders the shared `DataVisualizer` with the shared player (`hostPlayer`). New page body: `components/visual/DataStudio.tsx`. It has editable code, Run, Explain visually / Trace again, Stop, example presets, a Source code list that follows the stage, "Tables and arrays" / "Final variables" tabs, the adapter's honesty badge and its "Not supported here" list. A failed run still produces the failing stage (`visualizeOnError`); the page opens on that stage.
- `?preset=`: the old page had no URL ids. Old ids are the slugs of the old button labels (`LEGACY_DATA_PRESETS` in `workspace/adapters/data/presets.ts`). They map to `DATA_PRESETS` entries; new ids, short aliases (filter, groupby, broadcast, shapes, beforeAfter, ...) and unknown ids (fall back to the old default example) are handled by `resolveDataPreset`. Three presets were added so four old examples run unchanged (`pd-clean`, `pd-concat-dedupe`, `np-masks-slice-agg`); the other four map to supersets. Old button labels, the editor label "Python code to trace" and the `section[aria-label="Python code time machine"]` wrapper are kept because the Guide tour targets them.
- Table captions in the stage viewer are "Before this step", "After (changed cells highlighted)", "Current value" (the old viewer's text), and `ArrayView` includes the caption in its table name, so the old e2e selectors still match.

### Python: what is replaced and what is kept
| Piece | Decision | Why |
| --- | --- | --- |
| `TraceViewer` (`PythonTimeMachine.tsx`) | Kept, extended | Has the memory model, data tab, paged step list, gap detail and cost notes; `siteVisualTraceScale` and `siteVisualUi` test it directly. It now also shows step into/over/out/back (`pyStepper`), the branch and loop view (`pyBranches`), the error diagnosis (`pyDiagnose`) and the adapter's limitations list, through `components/visual/PyTracePanels.tsx`, which `PythonTraceVisualizer` uses too. One implementation of each. |
| `PyExplainBox`, `/visual/python` | Unchanged API, get the new panels | They render `TraceViewer`. |
| `PythonWorkspace` | Kept; adds a "Why it failed" block | The block comes from `explainPythonFailure` / `taskFailureFeedback` (adapter code). Grading, `recordPyAttempt`, mistakes, drafts, tabs unchanged. Only errors raised by the file's own `<exec>` code are explained (never stopped, timed-out, load or imported-file errors). |
| `PythonAssessmentPage` | Unchanged | No trace UI. Hints in a timed assessment would be wrong. |
| `lib/pyPractice.feedbackFor` | Kept | No UI uses it; a test pins it. |
| Limitations list | Moved to `adapters/python/limitations.ts` | One list (`PYTHON_LIMITATIONS`) shown by the workspace panel and by `TraceViewer`; not a second hardcoded list. |

### Pyodide line-number finding (confirmed in real Chromium, Pyodide 0.29)
Every traceback frame is `File "<exec>", line N, in <fn>`, including the tests' frames and the grading harness's, and Pyodide prints NO source text under any frame (CPython does). Phase 1's `learnerLine` only trusted a line whose printed text matched the learner's line, so in Pyodide it returned no line for runtime errors raised inside a learner function during tests. A second flaw: `diagnose()` falls back to the traceback's own line, so an assert on line 1 of the tests could be shown as line 1 of the learner's code. The worker sets `errorLine` only in the "code" phase.
Fix (`workspace/adapters/python/failure.ts`): `learnerLine(source, errorText, plainLine, tests?)` accepts a source-less frame only when its function is a `def` in the learner's source, is not defined in the tests, and the line is inside that def's body (innermost wins). `scrubTestFrames` renames other `<exec>` frames to `<tests>`. `taskFailureFeedback` is shared by the adapter and `PythonWorkspace`. Limits: lambdas, comprehensions and learner module-level code during a test run get no line (safe).

### Tests
Vitest (venv, `TZ=UTC`), passing: `siteWorkspaceVisualPresets` 12, `siteWorkspaceVisualPyodideLines` 9 (tracebacks copied from real Pyodide), `siteWorkspaceVisualData` 11 (real CPython behind the adapter's runner signature: stages, groups before aggregate, invalid broadcast and matmul, syntax error, Run reuse, step state across models), `siteWorkspaceVisualPythonWorkspace` 4, `siteWorkspaceVisualTraceViewer` 6. Earlier runs (before the last edits): `siteWorkspacePython*` 195, `siteWorkspaceData*` 322, `siteVisualUi` + `siteVisualPyTrace` + `siteVisualTraceScale` 120. No existing test or selector was changed.
Playwright `e2e/visual-workspace.spec.ts` (15 tests, owned by this agent), desktop, against a static build of this tree (`<scratchpad>/dist-a3`, served by `<scratchpad>/serve.mjs` on 5203): 3 passed, 12 failed (2.9 min). Per test:
- PASS 1 nested step into/out/over/back; PASS 2 sampled long loop disables stepping across its gap; PASS 3 failed Submit names the learner's line 2.
- FAIL 4 (practice page "Why it failed" / `<exec>` frames): real cause is the test, not the product. The practice page was filled with `typeInEditor` (Monaco `insertText`), whose auto-indent turned the multi-line function into `IndentationError: unexpected indent`, so the diagnosis correctly said so. Fixed in the spec by using `setValue` through `window.monaco`; not re-run.
- FAIL 5 to 15: not product failures. The static server was stopped by me while the run was still going, so these tests failed in under 1.2 s with `net::ERR_CONNECTION_REFUSED` (tests 11 and 12 show the error in the log; the others failed at the same point in the same way). They have NOT been run against a live server. An earlier run of the same tests on the shared dev server gave failures for merge keys, invalid broadcast, the exact (3,2)+(4,2) case, invalid matmul and read_csv, with reloads from other agents' HMR the likely cause; a hand check of `np-broadcast-bad` on the static build opened on Step 3 of 3.

### Not verified
Mobile, Firefox and WebKit for any spec; `visual.spec.ts` beyond one passing test ("Pandas studio", desktop, dev server); `visual-engines.spec.ts`; `smoke.spec.ts` Python flows; `sitePythonCurriculum`, `siteVisualEquivalencePython`, `sitePyAssessment`, `sitePyPractice`, `siteVisualHelp`, `siteVisualCoverage` were not run after the final edits; `pandas.read_csv` through `ExerciseDef.files` in real Pyodide (the spec test needs the Vite dev server and skips itself on a built copy).

### Limitations
`DataStudio` picks pandas or NumPy from the imports (labels only). "Final variables" shows end-of-run values. `LessonVisual` (Daily owner) still uses the old tracer's data tab for pandas or NumPy code.

### Tests and browser checks

- `siteWorkspaceDailyParity.test.tsx` (16 tests): store parity against the in-page runner, no pass on open, run, hint, solution or visualize, solution lock, drafts (save after the delay, restore on remount, Reset), two exercises with independent state, written exercise unchanged, runner fallback when the SQL checker or the engine refuses, embed counts (1,646 graded embedded, 223 written kept), server render has no workspace.
- `siteWorkspaceDailyAdapters.test.ts` (6 tests): every Daily SQL reference runs and validates through the SQL adapter on real PGlite (387 of 387 accepted by the safety checker at the last run); reference answers of a sample of Python, pandas and NumPy exercises pass the Python and data adapters on real CPython (`DAILY_ADAPTER_FULL=1` runs all).
- `e2e/daily-workspace.spec.ts` (10 tests, desktop and mobile, real PGlite and Pyodide, no mocks, run against a production build): SQL d031, Python d001, NumPy d063, pandas d070. Each opens the first guided exercise, runs the starter and builds the step view (no pass recorded, no `*_submitted` event), submits the reference answer from the lesson JSON, then checks `passed == ["g1"]`, `completeExercise` ran, no mistake, exactly one `*_submitted` event with `passed: true`, no horizontal overflow, no console errors, and after a reload the Passed badge, the opened card and the saved code are back. A second spec checks that two exercises of one lesson are separate and that a written exercise keeps its card.

### Existing tests changed

| Test | Change | Why the intent is kept |
| --- | --- | --- |
| `siteDailyPhase2Ui.test.tsx` | `runPython` mock gains `stopPython`; desktop `matchMedia`; "Check answer" replaced by Open the exercise + Submit; each try edits the code first | The lesson now shows the embedded workspace. The assertions (one counted mistake per wrong check, solved on a pass, no code stored, no mistake on a first-try pass) are unchanged. The workspace reuses the last run of unchanged code and the mock changes its answer between checks, so the code is edited. |
| `siteVisualEquivalenceUi.test.tsx` | Same mock and selector changes; the visual variant uses the workspace's Visualize button instead of the "Explain visually" block; the "open the block alone" test opens the Visualization pane | The in-page "Explain visually" block is gone from embedded exercises (the workspace has the visualization). All equivalence assertions (verdicts, progress, mistakes, study time, graded code identical with and without a real trace, 2 real CPython traces) are unchanged. |

### Findings and limitations

- A learner whose exercise falls back (engine failed to load, or the SQL checker refuses the exercise's own reference answer) gets the old runner; nothing else changes for them.
- Hints: the workspace ladder replaces the in-page list (one ladder, not two). Level 1 is a concept line from the lesson topics (guided only); a hint the content layer marks as the full answer is not shown in levels 1 to 4 (the lesson keeps it behind the unlocked solution).
- The category for a failed Python check is inferred from the failure text the session gives the port (crash text starts with the exception name), because the port interface has no run outcome. A traceback whose first line is not `XxxError: ...` is filed as "wrong-output" (the old runner would use the text as is).
- The workspace reuses the last run of unchanged code on Submit; the old runner re-ran. Output is deterministic, so the verdict is the same, except for a program that prints something random or time-dependent.
- After a reload the workspace session starts fresh (hint level, last result); the stored pass and draft stay (as before: the in-page runner never stored hints or results either).
- Dev-server note for e2e: other agents edit files in this tree, and `vite` dev reloads the page on every edit, which broke a test that was mid-run. The final e2e runs were against a production build served statically.
