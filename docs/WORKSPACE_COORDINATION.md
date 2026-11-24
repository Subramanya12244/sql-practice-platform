# Unified Exercise Workspace: coordination record

Written by the coordinator before any worker started. Workers read this first.

## Baseline (recorded 2026-11-18)

- Worktree: `/Users/subramanyaacharya/Downloads/project/sql-practice-platform-guide`
- Branch: `feature/dataforge-guide`. It was already merged into `main` (commit `ea88d14` is in `origin/main`). It was clean and 28 commits behind, so it was fast-forwarded (no history rewritten) to `origin/main` = `471fc05`.
- Uncommitted changes at start: none in this worktree.
- Other worktrees (do not touch): `sql-practice-platform-integration` (branch `feature/motion-icons-projects`, 2 dirty files, another session), `sql-practice-platform` (`feature/daily-learning`, 29 dirty files), `sql-practice-platform-evolution`.
- Nothing is committed, pushed, merged or deployed by this work. Workers do not run `git commit`, `git add`, `git stash`, `git reset`, `git checkout -- `, or any push.

## What already exists on main (reuse it, do not rebuild it)

Released as the Visual Learning Engine V1+V2, SQL Query Cinema, Learn hub, and the Guide. See `docs/VISUAL_LEARNING_REPORT.md`, `docs/VISUAL_LEARNING_COVERAGE.md`, `docs/QUERY_VISUALIZER_UX_REPORT.md`, `docs/HELP_GUIDE_PLAN.md`.

| Capability | Where |
| --- | --- |
| SQL execution (PGlite worker) | `frontend/src/site/lib/sqlRunner.ts`, `browserDb.ts`, `pglite.worker.ts` |
| SQL stages, join counts, set ops, row flow, plan | `lib/visualize.ts`, `lib/sqlClauses.ts`, `lib/sqlAst.ts`, `lib/visual/{cinema,rowFlow,rowTrace,setOps,planExplain,stageCompare}.ts`, `components/VizView.tsx`, `components/PlanTree.tsx`, `components/visual/{QueryCinema,QueryCompare,RowFlow,SetOpView}.tsx`, `pages/QueryVisualizerPage.tsx` |
| Pyodide runtime | `lib/pyRunner.ts`, `lib/pyodide.worker.ts` |
| Python tracer (`sys.settrace`, sampled, variables, call stack) | `lib/visual/{pyTrace,traceStore}.ts`, `components/visual/PythonTimeMachine.tsx` |
| Pandas/NumPy before-after grids | `lib/visual/dataDiff.ts`, presets in `pages/VisualPages.tsx` (`/visual/data`) |
| Shared player | `components/visual/Playback.tsx`, `lib/visual/playback.ts` |
| Explain levels (rule-based) | `lib/visual/explain.ts`, `components/visual/ExplainPanel.tsx`, `PyExplainBox.tsx` |
| SQL question grading | `lib/sqlRunner.ts` (`submit`), `lib/resultCompare.ts`, `components/PracticePanel.tsx`, `pages/QuestionPage.tsx` |
| Python exercises | `content/python/*.md` (under `src/site/`), `lib/pyExercises.ts`, `lib/tasks.ts`, `lib/pyPractice.ts`, `lib/pyAssessment.ts`, `components/PythonWorkspace.tsx`, `pages/PythonPracticePages.tsx` |
| Daily Learning lessons | `src/site/content/daily/days/dNNN.md|json`, `lib/daily*.ts`, `components/daily/*`, `pages/DailyPages.tsx`, manifest `docs/DAILY_LEARNING_AUTHORING_MANIFEST.jsonl`, coverage `docs/DAILY_LEARNING_CONTENT_COVERAGE.md` (generator `frontend/scripts/daily-coverage.mjs`) |
| Progress, mistakes | `lib/progress.ts`, `lib/pyPractice.ts`, `lib/mistakes.ts` (one store each; no new store) |
| Guide / Help | `src/site/help/**` (a section's `routes` must stay real; update content only through the coordinator) |

Honest note: the spec's Parts 3 to 6 are partly delivered already (stages, set ops, tracer, pandas/NumPy grids). The new work is the shared exercise schema + workspace, adapters wrapping the existing engines, embedding in exercise pages, gaps in those engines (listed in each brief), and curriculum reconciliation.

## Contract

`frontend/src/site/workspace/types.ts` is the single shared contract (Domain, ExerciseDef, ExecutionAdapter, Capability, RunOutcome, ValidationOutcome, VisualModel, VisualizerProps, ProgressPort). Agent 1 owns it from now on. Rules:

- Changes are additive. If a worker needs a breaking change, it stops and reports it to the coordinator in its final message (and writes the proposal under "Interface requests" at the bottom of this file).
- An adapter declares only capabilities it really has. The workspace hides controls for missing capabilities.
- An adapter wraps existing runners and grading. It never starts a second Pyodide or PGlite.
- No fabricated steps or rows. If an engine cannot produce a stage, `visualize` returns `null` and `limitations` says why.

## File ownership (exclusive; no one edits another owner's files)

| Owner | Owns |
| --- | --- |
| Agent 1, Shared architecture | `frontend/src/site/workspace/**` EXCEPT `workspace/adapters/{sql,python,data}/**` and `workspace/visualizers/{sql,python,data}/**`. Includes `types.ts`, `registry.ts` (adapter selection by domain), `ExerciseWorkspace.tsx`, panels (problem, editor, results, visualization host, hints, feedback, solution), responsive layout, `sources/*` converters from existing content to `ExerciseDef`, the progress port implementation (calls existing stores only). Tests `frontend/src/test/siteWorkspaceCore*.test.ts(x)`. |
| Agent 2, SQL | `workspace/adapters/sql/**`, `workspace/visualizers/sql/**`, and the existing SQL visual files: `lib/visualize.ts`, `lib/sqlClauses.ts`, `lib/sqlAst.ts`, `lib/sqlReview.ts`, `lib/visual/{cinema,rowFlow,rowTrace,setOps,planExplain,stageCompare}.ts`, `components/VizView.tsx`, `components/PlanTree.tsx`, `components/visual/{QueryCinema,QueryCompare,RowFlow,SetOpView}.tsx`. NOT `pages/QueryVisualizerPage.tsx`, `pages/QuestionPage.tsx`, `components/PracticePanel.tsx` (coordinator wires). Tests `frontend/src/test/siteWorkspaceSql*.test.ts(x)`. |
| Agent 3, Python | `workspace/adapters/python/**`, `workspace/visualizers/python/**`, `lib/visual/{pyTrace,traceStore}.ts`, `lib/pyErrors.ts`, `lib/pyodide.worker.ts`, `components/visual/{PythonTimeMachine,PyExplainBox}.tsx`. May add to `lib/pyRunner.ts` additively. NOT `components/PythonWorkspace.tsx`, `pages/PythonPracticePages.tsx`. Tests `siteWorkspacePython*.test.ts(x)`. |
| Agent 4, Pandas + NumPy | `workspace/adapters/data/**`, `workspace/visualizers/data/**`, `lib/visual/dataDiff.ts`, new `lib/visual/{dataframe,ndarray,broadcast}.ts`, new `components/visual/{DataFrameView,ArrayView,BroadcastView}.tsx`. It consumes Agent 3's tracer snapshots read-only and runs through the same Pyodide worker. NOT `pages/VisualPages.tsx` (coordinator wires). Tests `siteWorkspaceData*.test.ts(x)`. |
| Agent 5, Curriculum and content | `frontend/src/site/content/**` (daily, python, concepts, lessons), `docs/DAILY_LEARNING_*`, `frontend/scripts/daily-*.mjs`, `lib/visual/dailyVisual.ts`, the SQL question data source under `questions/**` and `frontend/public/data/q/**` only if the data is generated from `questions/` and the generator is rerun, curriculum tests `frontend/src/test/siteDaily*.test.ts`. New `docs/WORKSPACE_CONTENT_AUDIT.md`. No `.ts` or `.tsx` outside the files listed here. |
| Coordinator | `routes.tsx`, `pages/*`, `components/PracticePanel.tsx`, `components/PythonWorkspace.tsx`, `components/daily/*`, `help/**`, `SiteLayout.tsx`, `e2e/**`, `playwright.config.ts`, the final report, any file not listed above. |

## Shared-machine rules for workers

- One worktree and one branch are shared. Other workers edit at the same time, so `tsc` or tests may fail inside files you do not own. Do not fix them. Report them, and re-check later.
- Run only the tests you own plus `npx tsc --noEmit -p frontend` (or `tsc -b`) as a sanity check. Always run from `frontend/`. Use `TZ=UTC`.
- Playwright: each worker uses its own dev server port (Agent 1: 5201, 2: 5202, 3: 5203, 4: 5204, 5: 5205) and its own `--output` directory under the scratchpad, never the default `test-results`. `E2E_BASE_URL=http://localhost:<port>`. Never use 5174 (another tree).
- Browser e2e specs belong to the coordinator. Workers that need browser proof write a temporary spec in the scratchpad or ask the coordinator. Workers verify Python engines in real CPython and, where needed, real Pyodide via a script (see `frontend/scripts/help-examples-verify.ts` for the pattern).
- No new npm dependency without coordinator approval.
- Never claim a visualizer or adapter is complete without execution, validation and visualization tests that pass.
- Use the Windows/macOS-safe edits already used in this repo (no `sed -i` on macOS).
- The final message of each worker lists: files created, files modified, tests added with pass counts, commands run with results, limitations, and interface requests.

## Interface requests

(Workers append here.)

### Agent 4 (Learn hub and Projects Lab), 2026-11-18

1. Coordinator, `pages/WorkspacePage.tsx` and `components/WorkspaceLink.tsx`: optional back link. Request: `workspaceUrl(id, { from?: string })` that adds `&from=<encoded site path>`, and a "Back to <page>" link in `WorkspacePage` when `from` is a same-site path (validate it starts with `/` and not `//`). Learn hub, Projects Lab, scenario and question pages would then pass `from`. Today the browser Back button returns to the page; nothing breaks without this.
2. Coordinator, Guide (`help/`): new UI to describe if you want it in the Guide: "Practise in the workspace" on `/learn/topic/:slug`, "Next exercise to solve in the workspace" on `/learn/path/:id`, "Open a practice exercise" on project tasks and "Practise the concept first" on scenarios. None of them marks anything done.
3. Agent 3: `py:` exercises that import pandas have domain `python` in `workspace/sources/python.ts` (not `pandas`). Linked from Projects Lab (for example `py:pandas-groupby-agg`); confirm the Python adapter can run pandas, or the converter should give them the pandas domain.

### From Agent 1 (shared architecture)

Adapter module convention for Agents 2, 3, 4: `docs/WORKSPACE_ARCHITECTURE.md` section "Adapter module convention". Contract additions are listed in section 2 there (all additive).

Host page requests for the coordinator (Agent 1 does not edit pages):

1. Mount `EmbeddedExercise` from `frontend/src/site/workspace` (`import { EmbeddedExercise } from "../workspace"`). In a Daily lesson, next to each graded exercise: `<EmbeddedExercise exerciseId={`daily:${dayId}#${ex.id}`} />` (compact, loads on click). In the Learn hub: `<EmbeddedExercise exerciseId="sql:<slug>" />` or `exercise={def}`. Full page: `mode="full"`.
2. Hosts must render it under a Router (the statement renderer calls `useNavigate`) and the site `ThemeProvider` (Monaco). Put it in a `min-w-0` container: a Markdown table inside a flex item without `min-w-0` makes the page scroll sideways on phones.
3. If the workspace replaces the SQL or Python exercise page body later: the page must keep opening the solve session (`SolveTimer` / `openSession`), the draft save (`saveDraft`), and the page-level `track(...)` analytics, because the port deliberately does not. Until then the existing Check buttons and the workspace write the same stores and can coexist.
4. Content (Agent 5): 17 Daily hints are the complete answer (for example `d001#g1`, `d001#g2`). The workspace drops them from levels 1 to 4 so level 5 stays on request, but the existing lesson ladder still shows them. Daily exercises have no difficulty field; guided shows as Easy and independent as Medium.
5. `routes.tsx`, `pages/*`, `PracticePanel`, `PythonWorkspace`, daily components: no change requested for the core to work.

### From Agent 5 (curriculum and content), 2026-11-18

Details and evidence are in `docs/WORKSPACE_CONTENT_AUDIT.md`.

1. Coordinator or owner of the SQL question source: **Q19 is graded against the wrong query.** `frontend/public/data/q/q19-customers-above-average-revenue-using-cte.json` has `solution` and `referenceQuery` equal to Q197's recursive employee-chain query; its `mySolution` is the right customers query. A correct answer to Q19 can never pass. Agent 5 did not edit it: `public/data/q/**` is built by `scripts/build_public_data.py` from the sibling `northwind-sql-practice` repo (absent here), and `questions/questions.json` is stale (89 of 150 questions). Fix in the source markdown and regenerate, or hand-patch both fields to `mySolution`.
2. Agent 1 (`sources/*` converters): call `exerciseWorkspace(dayId, exerciseId, lessonTitle, lessonTopics)` from `lib/visual/dailyVisual.ts` for the domain, `visualization.presets` and extra packages of a Daily exercise (`null` means a written exercise: use `validation: { kind: "none" }` with its `rubric`). Daily exercise ids are `g1..gN` (guided) and `i1..iN` (independent). `lessonWorkspace()` gives the lesson's primary domain and per-domain counts (105 of 270 lessons mix domains, so launch per exercise).
3. Agent 1: hint levels. No format has 5 hints. Daily guided: 3 hints (levels 1 to 3), independent: none. SQL bank: no hints; `watchOutFor`, `approach`, `why` and `pitfalls` can seed levels 1, 2 and 4. Python library: 2 or 3 hints and an `explanation`. Leave missing levels empty (the contract allows it); level 5 is the stored solution. Do not synthesise hints.
4. Agent 1: the SQL bank's `expectedOutput` is mostly an illustrative sample (135 of 150), and many sample rows do not occur in the real result. Show the column description; if rows are shown, derive them from `referenceQuery`.
5. Agent 3 (Python adapter): 51 Daily exercises in 11 lessons import `scipy` (44) or `statsmodels` (7); the adapter must load those Pyodide packages or hide Run for them (`exerciseWorkspace().packages`). 8 exercises use `stdin`. 122 exercises use stdlib `sqlite3` (fine in Pyodide). Python exercises are validated by exact stdout (`expected`, per-line, trailing spaces ignored: `sameOutput` in `lib/daily.ts`).
6. Agent 2 (SQL adapter): Daily SQL exercises (387) are graded with `submit(db, learnerSql, solutionSql, ordered)`; 354 set `ordered`. 117 of them create their own tables first, so the adapter must run a multi-statement block and compare the last result. The runner forbids BEGIN, COMMIT and ROLLBACK.
7. Agent 4 (pandas and NumPy): the Python exercise library has only 3 pandas and 1 NumPy exercise; the Daily lessons supply 522 pandas and 63 NumPy graded exercises, all validated by printed output. Excel and Power BI lessons (a091 to a100, a124 to a137) launch the pandas workspace because their graded exercises are pandas replicas; do not label that visualization as Excel or DAX.
8. Coordinator: `components/daily/*` may use `lessonWorkspace()` and `exerciseWorkspaceDomain()` to offer "Open in workspace" per exercise. `scripts/daily-workspace-map.mjs --check` keeps the generated table honest (also tested in `siteVisualCoverageWorkspace.test.ts`).
9. Coordinator, informational: `src/test/siteDaily.test.ts` now puts the folder of `DAILY_PYTHON` first on the bash `PATH` (the `bash run` examples call `python`). Without it, 18 tests fail on any machine that has no `python` command or no `<repo>/.venv-daily`. CI or a developer machine needs a venv with `content/daily/requirements.txt` and `DAILY_PYTHON=<venv>/bin/python`.

### Agent 2 (SQL) requests

1. `ExerciseDef.readOnly?: boolean` (additive). The SQL adapter already reads it (`(ex as {readOnly?: boolean}).readOnly`); graded exercises (`validation.kind === "sql-result"`) are read-only without it.
2. `ExecutionAdapter.reset?(ctx: RunContext): Promise<void>` (additive). The SQL adapter implements it (drops the dataset's PGlite so the next run starts fresh) and declares the `reset` capability; the workspace should call it from its Reset control when present.
3. `VisualizerProps.hostPlayer?: boolean` (additive). When the workspace renders its own player, pass `true`: the SQL wrapper `SqlVisualizer` (removed on 2026-11-20, see docs/WORKSPACE_VISUALIZATION_QUALITY_REPORT.md section 7) hid its play/step/speed bar and followed `step`/`onStepChange` (it always stays in sync with them). Without it the visualizer shows its own controls.
4. Wrap the visualizer in `SqlBackendContext.Provider` only in tests; the default is the app's PGlite worker. Custom datasets must be registered with `registerDataset` (lib/browserDb) by the host before an exercise on them runs.
5. Wiring for the coordinator: `adapters/sql/index.ts` exports `adapterModule` (getAdapter + lazy-safe `Visualizer`), `adapter`, `sqlAdapter`, `createSqlAdapter`, `submitDetail(validation)` (the grader's SubmitResult with the row diff sample, for a diff table).

### From Agent 3 (Python), 2026-11-18

1. Agent 1 (`useExerciseSession.visualize`): it refuses to build a view when the run failed ("Run the code without errors first"). The Python tracer records the steps up to the exception and the diagnoser uses that state, so a failed run is where the view helps most. Request: let an adapter opt in, for example an optional `ExecutionAdapter.visualizeOnError?: boolean` (additive), and call `visualize` for `status: "error"` when it is true. The Python adapter's `visualize()` already works on a failed run (it traces the code itself); it returns null for a syntax error (nothing ran).
2. Agent 1: `Validation` python-tests has `hidden` and `stdin`, which the adapter uses. No change needed. The adapter calls `lib/tasks.ts` `runPythonTask` (the function PythonWorkspace uses), so nothing had to be extracted from the component.
3. Coordinator (`components/PythonWorkspace.tsx`, `pages/PythonPracticePages.tsx`): optional. `PyExplainBox` and `PythonTimeMachine` could show the new step controls, branch/loop panel and diagnosis by rendering `PythonTraceVisualizer` (`workspace/visualizers/python`) instead of `TraceViewer`. Not done here because both pages are coordinator files. `diagnoseAll` (`lib/visual/pyDiagnose.ts`) can also replace the static hint list in `lib/pyPractice.ts` `feedbackFor` if a richer message is wanted there.
4. Coordinator, e2e: real Pyodide was not started by this agent (CI sandbox has no CDN check). The adapter is tested against a CPython runner with the worker's contract. A browser spec should: open a Python exercise, Run, Visualize, press Step over/into/out, and confirm a sampled long loop disables stepping across its gap. Open question for that spec: in Pyodide, a traceback frame from the tests is also named `<exec>`; `learnerLine` (adapters/python/failure.ts) only trusts a line when the printed source text matches the learner's line, so confirm Pyodide prints the source text for `<exec>` frames (if it does not, a failed test gives feedback without a line number, which is safe).
5. Agent 5's note (scipy/statsmodels): the worker already calls `loadPackagesFromImports` for every run, so the adapter needs no extra package list. Traced runs add dead `import` lines (`importHints` in pyTrace.ts) for the same reason.

### Agent 4 (pandas and NumPy), interface requests

- `ExerciseDef.files?: Record<string, string>` (additive): virtual files for `pd.read_csv("x.csv")`. `lib/pyRunner.runPython` and the worker already accept `files`; the data adapter reads `exercise.files` loosely today and passes it through, so nothing breaks if the field is added later.
- Host wiring (coordinator): `/visual/data` can offer `DATA_PRESETS` (`workspace/adapters/data/presets.ts`) and render the same stage viewer via `workspace/visualizers/data` (`DataVisualizer`). `PythonTimeMachine` and `pyTrace.ts` were not touched and need no change.
- Pyodide facts recorded: the worker loads packages with `loadPackagesFromImports(code + tests + files)` from Pyodide v0.29.5 (Python 3.13.2, numpy 2.2.5, pandas 2.3.3). The probe repeats the learner's `import` lines in dead code (same trick as `pyTrace.buildTraceProgram`) so pandas and numpy are found.
- Test environment: this worktree has no `.venv-daily`. `siteVisualInterview.test.ts` falls back to bare `python3` (no pandas) and fails 3 pandas snippets here; they pass where `.venv-daily` exists. The data tests look for a Python with numpy and pandas in this order: `DATA_PYTHON`, `DAILY_PYTHON`, `<worktree>/.venv-daily`, the sibling worktrees' `.venv-daily`, `python3`, and skip when none has both.
- Agent 4 also needs Agent 3's `visualizeOnError` request (item 1 above): the data adapter's `visualize()` works on a failed run and the invalid-broadcast and invalid-matmul views are only reachable through a failed run (the failing stage shows both operands' real shapes, the alignment table and NumPy's real error).


---

# Phase 2: integration completion and correctness hardening (coordinator, 2026-11-18)

Baseline at the start of phase 2: worktree `sql-practice-platform-guide`, branch `feature/dataforge-guide`, HEAD `471fc05`, 45 uncommitted entries, 0 stashes. Nothing committed, pushed, merged or deployed. Phase 1 reports are treated as historical: each agent re-verifies what it touches.

## Contracts fixed before phase 2 workers started (all additive, in `workspace/types.ts`)

- `SqlPolicy = "read-only" | "own-tables" | "own-data"` and `ExerciseDef.sqlPolicy?`. Absent means: derived by the SQL adapter from the reference query. `readOnly` stays as an alias of `read-only`. Owner of the policy engine: Agent 1.
- `DebugNote` and `ExerciseDef.debugging?`, `constraints?`, `realWorld?`. Shown by `ExplanationPanel` ("If something goes wrong") and `ProblemPanel`.
- `ExerciseEnrichment` (teaching content by exercise id) loaded from `src/site/content/workspace/enrichment/*.json` as `{ "version": 1, "items": { "<exercise id>": {...} } }` by `workspace/sources/enrichment.ts` and merged in `loadExerciseById`. It never changes `validation`, `starterCode` or `solution.code`. `enrichmentProblems()` is the validator (unknown category, empty fields, hint that contains the full solution).
- Hint levels are 1 to 4 from content and 5 is the stored solution on request. The brief's five hint ideas map to: 1 concept, 2 syntax or concept to use, 3 approach, 4 structured steps with a skeleton in which the key expression is left for the learner (merges "partial implementation" and "near-complete guidance"). Level 5 (full solution) stays an explicit request. This is a documented deviation from "five hint levels before the solution".
- Progress: one store per domain, unchanged. Daily completion goes through the lesson store (`updateDay`, `completeExercise`), which only Agent 2's `workspace/dailyPort.ts` may call from the workspace.

## Phase 2 ownership (exclusive)

| Owner | Owns |
| --- | --- |
| Agent 1, SQL correctness and safety | `workspace/adapters/sql/**`, `workspace/visualizers/sql/**`, `lib/sqlRunner.ts` (additive options only), `frontend/public/data/q/q19-*.json` and any other `q*.json` it proves wrong (list each in the doc first), tests `siteWorkspaceSqlSafety*`, `siteSqlQuestion*`, `docs/WORKSPACE_SQL_SAFETY.md`. Dev port 5201. |
| Agent 2, Daily inline integration | `components/daily/**`, `pages/DailyPages.tsx`, `components/visual/LessonVisual.tsx`, `lib/daily*.ts` (additive), `workspace/dailyPort.ts`, `workspace/EmbeddedExercise.tsx` (additive props), tests `siteWorkspaceDaily*`, `e2e/daily-workspace.spec.ts`. Dev port 5202. |
| Agent 3, Python, Pandas and NumPy integration | `pages/VisualPages.tsx`, `components/PythonWorkspace.tsx`, `pages/PythonPracticePages.tsx`, `pages/PythonAssessmentPage.tsx`, `components/visual/{PythonTimeMachine,PyExplainBox}.tsx`, `lib/visual/{pyTrace,traceStore,pyStepper,pyBranches,pyDiagnose,dataDiff,dataframe,ndarray,broadcast,dataProbeProgram}.ts`, `workspace/adapters/{python,data}/**`, `workspace/visualizers/{python,data}/**`, `components/visual/{DataFrameView,ArrayView,BroadcastView}.tsx`, tests `siteWorkspaceVisual*`, `e2e/visual-workspace.spec.ts`. Dev port 5203. |
| Agent 4, Learn hub and Projects Lab | `pages/LearnHubPages.tsx`, `pages/LearnPages.tsx`, `components/learn/**`, `lib/learn*.ts`, `pages/ProjectsPages.tsx`, `components/projects/**`, `lib/projects*.ts`, `pages/ScenarioPages.tsx`, `pages/QuestionPage.tsx`, `pages/QuestionsPage.tsx`, `pages/TopicPage.tsx`, new `lib/workspaceLinks.ts`, tests `siteWorkspaceLinks*`, `e2e/workspace-discovery.spec.ts`. Dev port 5204. |
| Agent 5, Curriculum and content quality | `src/site/content/**` including `content/workspace/enrichment/*.json`, `frontend/scripts/daily-*.mjs`, `lib/visual/dailyVisual.ts`, tests `siteDaily*`, `siteVisualCoverage*`, `siteWorkspaceEnrichment*`, `docs/WORKSPACE_CONTENT_AUDIT.md`. Not `public/data/q/**`. Dev port 5205. |
| Coordinator | `workspace/types.ts`, `workspace/sources/**`, `workspace/panels/**`, `workspace/hints.ts`, `workspace/registry.ts`, `workspace/progressPort.ts`, `workspace/useExerciseSession.ts`, `workspace/ExerciseWorkspace.tsx`, `routes.tsx`, `pages/WorkspacePage.tsx`, `components/WorkspaceLink.tsx`, `help/**`, `SiteLayout.tsx`, `e2e/workspace.spec.ts` and all existing e2e, final docs (`WORKSPACE_ARCHITECTURE.md`, `WORKSPACE_INTEGRATION_REPORT.md`, `WORKSPACE_REGRESSION_REPORT.md`). |

A worker that needs a change in a file it does not own, or a contract change, writes it under "Phase 2 interface requests" below and stops that part of the work.

Test environment for every worker (read-only use of an existing venv, do not modify it): `V=/Users/subramanyaacharya/Downloads/project/sql-practice-platform-integration/.venv-daily`, then from `frontend/`: `PATH=$V/bin:$PATH DAILY_PYTHON=$V/bin/python TZ=UTC npx vitest run ...`. Expensive suites (`siteDaily`, `siteVisualEquivalencePython`) run alone with `--maxConcurrency=2`. Playwright: own port, own `--output`, `--workers=1`, `E2E_BASE_URL`.

## Phase 2 interface requests

(Workers append here.)

### From Agent 5 (curriculum and content quality), phase 2, 2026-11-18

Evidence is in `docs/WORKSPACE_CONTENT_AUDIT.md` section 12.

0. Coordinator (`siteWorkspaceCoreSources.test.ts`, line 148 "loads each kind by id and returns the same def as the converter"): the test compares `loadExerciseById` with the raw converter for the first SQL question and the first Python exercise, so it fails as soon as either has enrichment. Two finished items (`sql:q01-product-revenue`, `py:cart-line-total`) are parked in `content/workspace/pending/` so that the suite stays at 67 of 67. Fix: compare against `loadBaseExerciseById(...)` (and assert the enriched def equals `mergeEnrichment(base, item)`), then move the two files to `content/workspace/enrichment/`.
1. Coordinator (`workspace/sources/enrichment.ts`): `enrichmentProblems` accepts the flat union of SQL and Python debugging categories, so a Python note labelled `window` would pass. `siteWorkspaceEnrichment.test.ts` enforces the per-domain lists (SQL: syntax, join, filter, grouping, aggregation, null, window, performance; Python family: the 16 in the brief). Optional: pass the exercise's domain to the validator and check there. No data change needed.
2. Coordinator (`workspace/sources/enrichment.ts`, `hints.ts`): all 118 enriched items supply hints at all four levels, and `mergeEnrichment` replaces the converter's hint at each supplied level. So for these items the converter's level-1 concept line and the authored Daily hints are replaced, not shown beside mine. That is intended. Items without enrichment keep the converter's ladder.
3. Owner of `siteVisualInterview.test.ts` (not in my ownership list): the test falls back to bare `python3` when `<repo>/.venv-daily` is missing and ignores `DAILY_PYTHON`, so 3 pandas snippets fail with `ModuleNotFoundError: No module named 'pandas'` in a worktree without a local venv (reproduced; they pass with the venv on `PATH`). Suggested: resolve the interpreter like `siteDaily.test.ts` does (`DAILY_PYTHON`, then `<repo>/.venv-daily`, then `python3`).
4. Coordinator, UI: the 118 items carry `alternatives` on 70 exercises (one each) with a `note` that states the trade-off. `ExplanationPanel` should show the note beside each alternative, because without it an alternative is just more code. All alternatives are executed by the test, so labelling them "verified" is accurate.
5. Coordinator, informational: the 17 Daily hints that were the complete answer were replaced at source (guided hint 3 of d001, d031, d032, d034, d036, d047, d054, d058). The lesson ladder no longer shows an answer; the workspace's `leaksSolution` filter now finds nothing to drop in Daily.
6. Content gaps that need an owner decision, not a code change: Kafka and streaming (one note), Terraform (one bullet), and no exercise at all that uses a matrix product (`@`, `np.matmul`, `np.dot`).

### Agent 2 (Daily inline integration), Phase 2 requests

1. Coordinator, `workspace/progressPort.ts` (`storeProgressPort`, Daily branch): it re-implements what `workspace/dailyPort.ts` now does through the shared `lib/dailyExercise.ts` (`recordDailyCheck`). The copy lacks `markMistakeSolved` before `completeExercise`, the `python_executed` / `*_submitted` activity events, the draft save, and the Daily Python failure category rule (`pyCategoryOfFailure`). Replace the Daily branch with a call to `createDailyPort().recordAttempt(...)` (same for `recordRun`), so `/workspace?e=daily:...` and the lesson write exactly the same records.
2. Coordinator, `/workspace` page for a `daily:` id: call `saveDailyDraft` (lib/dailyExercise.ts) from `onCodeChange` (use `useDraftSaver` from `components/daily/useDraftSaver.ts`) and start from `rec.drafts[exerciseId]`, so a draft written in the lesson is not lost on the full page and the reverse.
3. Agent 1 / coordinator, `ExplanationPanel`: the level-5 confirm says "This exercise will count as solved with assistance". That is false for Daily (opening a solution records nothing and never passes it). The lesson therefore shows its own, gated solution (`SOLUTION_LOCKED_NOTE`, unlock after a pass, two failed checks or every hint) and blanks `solution.code` on the embedded exercise. If the workspace later owns the solution for Daily, make that sentence host-configurable first.
4. Coordinator, `EmbeddedExercise`: with an `exercise` prop the `defer` / "Open the exercise" gate is skipped (only `exerciseId` is deferred). The Daily card therefore does its own deferral. A `defer` that also applies to `exercise` would let hosts drop that code.
5. Agent 1 (SQL policy): the lesson asks the adapter's own `policyOf` + `checkSqlPolicy` whether the exercise's reference answer is allowed (`sqlWorkspaceRunnable` in `workspace/dailyPort.ts`) and keeps the in-page runner when it is not. During this phase the policy engine was refused or unreadable for 221 of 387 Daily SQL references in vitest (`Syntax error at line 1 col 17`) and in the Vite dev browser it threw `(0 , moo_1.keywords) is not a function` (pgsql-ast-parser's `moo` import). Both were gone on the last run (387 of 387 accepted in node); keep `siteWorkspaceDailyAdapters.test.ts` green after your changes and tell the coordinator before renaming `policyOf`, `checkSqlPolicy` or `derivePolicy`.

### Agent 3 (Python, pandas and NumPy visualization), Phase 2 requests

1. Coordinator, `help/content/visual.ts` (Guide for `/visual/data`): the editor note says run shortcuts do nothing, but Ctrl/Cmd+Enter now triggers Explain visually; the Variables tab is now "Final variables"; the text says "six pandas examples" and the tour step `explain` targets `section[aria-label="Python code time machine"] button` (kept on the page for compatibility; rename both together). There is now a Run button, an "Examples" group (the 8 old buttons plus more examples and two invalid operations) and a "Not supported here" list.
2. Agent 2 (`components/visual/LessonVisual.tsx`): for pandas or NumPy code it still renders `PythonTimeMachine mode="data"` (old tracer). It could render the data adapter's stage view (`DataStudio` internals: `adapters.run` then `visualize`, `DataVisualizer` with `hostPlayer`).
3. Coordinator, e2e: run specs against a built copy, not a shared dev server (other agents' HMR reloads pages mid-test). `visual-workspace.spec.ts` has one test (`read_csv` via `ExerciseDef.files`) that imports `/src/...` and skips itself on a built copy; run it once on a dev server. Also 3 failures to diagnose from real output: failed Submit/practice failure help, merge keys, `read_csv`.

### Phase 2 Agent 1 (SQL correctness and safety), 2026-11-18

Details: `docs/WORKSPACE_SQL_SAFETY.md` (section 12).

1. `lib/browserDb.ts` (coordinator): add `opts?: { policy?: PolicyOption }` to `runQuery` and `submitQuery` and pass it to `execute` / `submit` (from `lib/sqlRunner`). Today `adapters/sql/backend.ts` `browserBackend` reproduces the 8 s limit itself when a policy is given.
2. Source repo `northwind-sql-practice` and `backend/app/services/repo_parser.py` / `scripts/build_public_data.py` (not owned by any worker): `find_sql_for_md` uses a prefix glob, so Q19 picked Q197's `.sql`. Exact-number match plus an assertion are specified in section 9.5. Until the generator is fixed, regenerating `public/data/q/**` brings the Q19 bug back and overwrites the patches in Q19, Q32, Q33, Q36, Q62, Q96, Q97.
3. Pages that call `lib/sqlRunner` themselves (`components/daily/*`, `components/PracticePanel.tsx`) are unchanged and have no policy; pass `{ policy: await policyOf(exercise) }` (exported from `workspace/adapters/sql`) to get it.

## Visualization interface requests

### Agent D (Pandas), 2026-11-19

1. Coordinator, `components/visual/DataStudio.tsx` (line ~215): `<PlaybackBar pb={pb} labels={data.analyses.map((a) => a.title)} />` labels steps by stage, but a step is a beat now, so a stage with several beats leaves the timeline labels shifted and shorter than the step count. Use the same labels as `DataStageViewer` (`beats.map((b) => (b.of > 1 ? \`${data.analyses[b.stage].title}: ${b.title}\` : b.title))`, `beats` is already computed in that file).
2. Coordinator, `workspace/visualizers/data/DataStageViewer.tsx`: the "Code, shapes and every table for this stage" block is collapsed for beats that have a picture. The pandas e2e tests that looked for a table named `Current value|After|Before` or for the text `N in, M retained, K removed` read the stage's own panels, which are inside that collapsed block; they were adjusted (see the Pandas section of `WORKSPACE_VISUALIZATION_QUALITY_REPORT.md`). If you would rather keep those tests untouched, open the block by default on the last beat of a stage.
3. Agent N / anyone: `dataProbeProgram.ts` gained one additive field, `DataStage.cond` (the parts of a `df[<condition>]` filter: each comparison with its two operands and its own True/False column). It is only recorded for call-free conditions (a few safe methods such as `mean()` are allowed). `_opnd` also records a numpy scalar as its Python value. No existing field changed.

### Agent P (Python story), interface requests

1. Coordinator, `components/visual/StoryPanel.tsx`: add an optional `reduced?: boolean` prop and drop the `df-step` class when it is true. Today only the OS-level `prefers-reduced-motion` CSS silences the entrance, so a learner who turns on the in-app "Reduce motion" switch still gets that one slide of the story text (`siteStoryPythonUi.test.tsx` documents it). Python would then pass `reducedMotion`.
2. Coordinator, `components/visual/story.ts`: `storyProblems` treats the words `null`, `undefined`, `NaN`, `Infinity` as broken text (case-insensitive), so a Python story that quotes a real `nan` or `inf` float would be flagged. Python stories do not hit this today (the formula reader refuses `nan` and `inf`); an `allowNaN`-style option for `inf` would make it safe to quote them.
3. Coordinator, `site.css`: no change needed. The picture uses the existing `df-cell` (pop) and `df-step` keyframes plus Tailwind `transition-[...]`; a dedicated `df-highlight` keyframe would let the current list item pulse once instead of fading.
