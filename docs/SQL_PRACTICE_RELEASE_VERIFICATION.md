# SQL Practice visualizer: release verification

Branch `feature/sql-visualizer-restore`, worktree `sql-practice-platform-sqlviz`. Written by Release Agent 5 (full regression, build, accessibility and release verification). This is a release gate: no source code and no existing test was edited.

Status: all four sections done, run on the final tree (after the stale-query, layout/step-bar, SUM-lane, `teach.ts` rowsIn and table-header fixes landed; gates re-run from scratch on 2026-11-25). Result: every automated gate is green; two accessibility findings remain, both outside the new code (section 3.4).

## 1. The 1187 Vitest failures: environment, not regression

### 1.1 Symptom

A full `npx vitest run` on this branch reported 1187 failures: 1184 in `frontend/src/test/siteDaily.test.ts` and 3 in `frontend/src/test/siteVisualInterview.test.ts`. An earlier report blamed a missing pandas in the local Python but never checked it against the base commit. This section checks it.

### 1.2 The failures, grouped by message

Run: `cd frontend && TZ=UTC npx vitest run src/test/siteDaily.test.ts src/test/siteVisualInterview.test.ts` with no `DAILY_PYTHON` and no `.venv-daily` (the default on this machine, which falls through to the Homebrew `python3` 3.14.6). Result: 4998 tests, 3809 passed, 1187 failed, 2 skipped.

| Count | File | Message (shortened) | Example test |
| --- | --- | --- | --- |
| 592 | siteDaily | `solution stderr: expected 'Traceback (most recent call last): ...' to be ''` | `a091 execution guided g1 (...): the solution passes and the starter does not` |
| 574 | siteDaily | `stderr: expected 'Traceback (most recent call last): ...' to be ''` | `a091 execution example ex1 (A Table as a DataFrame) prints its expected output` |
| 4 | siteDaily | `exit status; stderr: : expected 1 to be +0` | `d061 execution example ex5 (...)` |
| 8 | siteDaily | `expected 'bash: line N: python: command not found' to be '....'` or `exit status; stderr: bash: python: command not found` | `d061 ex2`, `d062 ex4`, `a179 ex1`, `d022 ex4`, `d022 ex5` |
| 3 | siteVisualInterview | `stderr: expected 'Traceback (most recent call last): ...' to be ''` | `the stated outputs are true: Python snippets are run with real Python pd-topn-group (answer 1)` |

Total: 1184 (siteDaily) + 3 (siteVisualInterview) = 1187. All of them are tests that execute a lesson's Python or shell example with a real interpreter; none touches the SQL visualizer.

Root cause, checked directly on this machine: `python3 --version` is 3.14.6 and `python3 -c "import numpy"` and `python3 -c "import pandas"` both fail with `ModuleNotFoundError: No module named 'numpy'` (and `pandas`). The Daily Learning examples tagged `python local` import numpy, pandas, scipy, statsmodels, matplotlib and so on, so each one raises a traceback. The `python: command not found` cases are shell examples that call `python`; the test builds a sandbox `PATH` of `<dirname(DAILY_PYTHON)>:<repo>/.venv-daily/bin:/usr/bin:/bin:/opt/homebrew/bin:/usr/local/bin`, and with a bare `python3` and no venv, no `python` exists on it (macOS and Homebrew only ship `python3`).

### 1.3 The repository's intended Python environment

- `frontend/src/test/siteDaily.test.ts` header: `DAILY_PYTHON=/path/to/python  interpreter for python run / python local (default: <repo>/.venv-daily, then python3)`.
- `.github/workflows/deploy.yml`: `actions/setup-python@v5` with Python 3.13, then `python -m venv .venv-daily && .venv-daily/bin/pip install -r frontend/src/site/content/daily/requirements.txt`, then `npx vitest run`.
- `frontend/src/site/content/daily/requirements.txt`: numpy>=2.2.5, pandas==2.3.3, scipy, statsmodels, matplotlib, seaborn, plotly, requests, sqlalchemy, pytest, openpyxl, pydantic.
- No `.venv-daily` exists in this worktree or in the base scratch worktree. This machine has Homebrew python3 3.14.6 (no numpy or pandas) and Anaconda `/opt/anaconda3/bin/python3.13` (Python 3.13.9, the CI version; it has numpy 2.3.5 and pandas 2.3.3, but the repo's tests pin neither it nor a venv).
- Test files that read `DAILY_PYTHON` (all fall back to `<repo>/.venv-daily/bin/python`, then `python3`): `siteDaily.test.ts`, `siteStoryPython.test.ts`, `siteStoryPythonUi.test.tsx`, `siteVisualEquivalencePython.test.ts`, `siteVisualEquivalenceUi.test.tsx`, `siteVisualInterview.test.ts`, `siteVisualPyTrace.test.ts`, `siteVisualTraceScale.test.ts` (also `PY313`, default `/opt/anaconda3/bin/python3.13`), `siteWorkspaceDataPy.ts`, `siteWorkspaceEnrichment.test.ts`, `siteWorkspacePythonAdapter.test.ts`, `siteWorkspacePythonDiagnose.test.ts`, `siteWorkspacePythonStepper.test.ts`, `siteWorkspacePythonUi.test.tsx`, `siteWorkspaceVisualTraceViewer.test.tsx`. `notesLayout.test.ts` probes `process.env.PYTHON` and system pythons instead.

### 1.4 Environment built for the check

PyPI was reachable; nothing blocked the install.

```
/opt/anaconda3/bin/python3.13 -m venv <scratchpad>/venv313
<scratchpad>/venv313/bin/pip install -r frontend/src/site/content/daily/requirements.txt   # exit 0
```

The venv lives outside the repository (scratchpad `venv313`, not committed). It resolved to Python 3.13.9, numpy 2.5.5, pandas 2.3.3, with all other requirements importing cleanly. It follows the CI recipe (3.13 plus the requirements file).

### 1.5 Results with `DAILY_PYTHON` set, current tree against base

Command (identical on both trees): `cd frontend && DAILY_PYTHON=<scratchpad>/venv313/bin/python TZ=UTC npx vitest run src/test/siteDaily.test.ts src/test/siteVisualInterview.test.ts`. The base tree is a detached scratch worktree of commit `0bcf77a` with `frontend/node_modules` symlinked from the main worktree (removed after the check).

| Tree | Python | Tests | Passed | Failed | Skipped | siteDaily failed | siteVisualInterview failed |
| --- | --- | --- | --- | --- | --- | --- | --- |
| This branch (merged with origin/main) | system python3 3.14.6, no packages | 4998 | 3809 | 1187 | 2 | 1184 | 3 |
| Base `0bcf77a` | system python3 3.14.6, no packages | 4998 | 3809 | 1187 | 2 | 1184 | 3 |
| This branch | venv313 (3.13.9 plus requirements) | 4998 | 4996 | 0 | 2 | 0 | 0 |
| Base `0bcf77a` | venv313 (3.13.9 plus requirements) | 4998 | 4996 | 0 | 2 | 0 | 0 |

The failing test sets were compared test by test (file plus full test name): without the venv, this branch and the base fail the identical 1187 tests (0 only on this branch, 0 only on base). With the venv, both fail none. The 2 skipped tests are the same on both trees.

Note the total (4998) is the same on both trees for these two files because this branch adds no test to them.

### 1.6 Classification and conclusion

All 1187 failures are environmental: the local `python3` (3.14.6) lacks the numpy/pandas/scipy and other packages that the Daily Learning and Visual Interview Python examples need, and no `.venv-daily` is present. They are not a regression from this branch: the unchanged base commit fails the same 1187 tests with the same messages, and with the CI-recipe venv both trees pass all 4996 non-skipped tests. No test, source file or fixture was modified.

How to reproduce the green run: create the venv per section 1.4 (or `python3.13 -m venv .venv-daily && .venv-daily/bin/pip install -r frontend/src/site/content/daily/requirements.txt` in the repository root, as CI does), then `DAILY_PYTHON=<venv>/bin/python TZ=UTC npx vitest run`. The final full-suite run in section 2 uses this environment.

## 2. Final-tree gates

All commands run in `frontend/` on the final tree (final tree after the `teach.ts` rowsIn fix, the `ClassicStepBar`/`ClassicTable` hardening and the `.vizc-th` rule: 2 modified and 31 untracked entries, listed in section 4; source and e2e hash recorded before the build and unchanged after the Vitest run).

| Gate | Command | Result |
| --- | --- | --- |
| TypeScript | `npx tsc --noEmit -p tsconfig.json` | exit 0, no output |
| ESLint | `npx eslint src` | exit 0, no output (0 errors, 0 warnings) |
| Full Vitest suite | `DAILY_PYTHON=<scratchpad>/venv313/bin/python TZ=UTC npx vitest run` | 171 files, 8493 tests: 8483 passed, 0 failed, 10 skipped. 1410 suites passed, 0 failed. Wall time about 8 minutes on an otherwise idle machine |
| Production build | `VITE_SITE_URL=https://dataforge.dataforge-learn.workers.dev npm run build:site` | exit 0. 1139 pages prerendered (1114 in the sitemap), 150 OG images. Built at 11:58 IST on the final tree; `frontend/dist-site` is left in place from this build. Only the usual chunk-size notice and a Node `localStorage` experimental warning |
| Prerender check | `npm run check:prerender` | exit 0: "no failed Suspense boundaries in dist-site" |

This run replaces an earlier one (8473 passed of 8483). The test count grew by 10: 9 new tests in `siteClassicTeach.test.ts` (65 tests now) and 1 new test in `siteClassicLayout.test.tsx` (13 now).

The 10 skipped tests are not new: `siteDaily.test.ts` 2 ("authored days exist for every curriculum day" needs `DAILY_REQUIRE_ALL`; "has Python available" is a guard that only fires when Python is missing), `siteHelpExamples.test.ts` 2 (numpy and pandas help examples), `siteSupabaseSyncLive.test.ts` 6 (live Supabase staging, needs credentials).

Two earlier attempts of this same gate on this tree reported 55 and 68 failures. They were not code failures: every one was a `Test timed out in ...ms` or a killed Python harness ("equivalence harness: killed after timeout", "Hook timed out"), in the Python-spawning suites (`siteDaily`, `siteVisualEquivalencePython`, `siteGuidedLabs`, `siteTasks`, `siteWorkspace*`), while the machine was oversubscribed by other agents' browser and Vitest runs (load average above 100 during those runs, 8 on the clean run). The clean run, with nothing else running, has 0 failures, so the suite needs an unloaded machine to pass; the timeouts are a test-environment limit, not a regression.

Python environment for the run: venv built from `/opt/anaconda3/bin/python3.13` with `frontend/src/site/content/daily/requirements.txt` (section 1). Without it the same suite reports the 1187 environmental failures described in section 1; with it, zero.

Playwright suites were not part of this gate (they belong to the QA agent and the browser-matrix agent); the accessibility probe below used a standalone Playwright script, so no shared `test-results` directory was touched. `frontend/dist-site` (build output) and `frontend/tsconfig.tsbuildinfo` are gitignored.

## 3. Accessibility, keyboard and reduced motion

### 3.1 Method

Standalone script (scratchpad, not in the repository) driving system Chrome against the dev server on port 5195 (`vite --config vite.site.config.ts`, stopped afterwards). axe-core 4.10.2 (not installed in `frontend/node_modules`; installed into the scratchpad with `npm i axe-core@4.10.2`), tags `wcag2a`, `wcag2aa`, `wcag21aa`, whole document.

Page: `/questions/q01-product-revenue`. Onboarding skipped with `localStorage df.help.v1 = {"version":1,"onboarding":"skipped","tours":{}}`; theme through `sqlp.theme`. Driving as in `sql-practice-original-visualizer.spec.ts`: Monaco `getModels()[0].setValue(...)` with the Q01 revenue query (JOIN, GROUP BY with SUM, ORDER BY), "Run All", "Visualize query" tab, "Visualize my query"; on a phone "Visualize ↗" first. The visualizer showed 4 logical steps; the audits were taken at step 2 of 4 (the middle step, after clicking "Next step" once).

States audited in each of desktop 1440x900 and phone 390x844 (touch, mobile emulation), light and dark (4 configurations):
1. middle step, full page;
2. compact step bar visible with the full player scrolled out of view;
3. stale notice shown (the editor changed after the run, without running).

The three tables on the page at the middle step: "rows entering GROUP BY ..." (scrollWidth 1904 in a 484 px box on desktop, 314 px on a phone, so it scrolls sideways; the other two are 484 on desktop and 411 and 432 on a phone, so they scroll there), "groups" and "Rows". After the table-header change (column names now break at underscores) each is still a `role="region"` with `tabindex="0"` and a label ending "table, scrolls sideways when wide", so axe's `scrollable-region-focusable` passes.

### 3.2 axe-core results

| Configuration | State | Violations | Incomplete (needs review, not failures) |
| --- | --- | --- | --- |
| desktop light | middle step | 1 rule, 2 nodes: `color-contrast` | contrast 109 (canvas and gradient backgrounds), aria-prohibited-attr 1, link-in-text-block 1 |
| desktop light | compact step bar visible | same 2 nodes | contrast 260 |
| desktop light | stale notice | 0 | contrast 129 |
| desktop dark | middle step | 0 | contrast 109 |
| desktop dark | compact step bar visible | 0 | contrast 260 |
| desktop dark | stale notice | 0 | contrast 129 |
| phone light | middle step | 1 rule, 1 node: `label` | link-in-text-block 1 |
| phone light | stale notice | same 1 node | |
| phone dark | middle step | 1 rule, 1 node: `label` | link-in-text-block 1 |
| phone dark | stale notice | same 1 node | |

On the phone the compact step bar is visible only while the visualizer is on screen and the full player has scrolled above the sticky header (measured: the bar appears at document scroll 1000 px and goes away again after about 3000 px, when the whole visualizer has scrolled past, as the component comment describes). It was audited at the first scroll position where it shows, in both themes: the only violation is the same `label` node.

### 3.3 Every violation, with selector and owner

| # | Rule | Selector | Detail | Where | Owner | New in this branch? |
| --- | --- | --- | --- | --- | --- | --- |
| V1 | `color-contrast` (serious) | `.viz-clause-highlight.mtk14.mtkb:nth-child(4)` and `:nth-child(6)` | Monaco editor tokens (bold teal #0f766e on the clause highlight #ddddfc): contrast 4.12:1, needs 4.5:1. Desktop light only; the dark theme passes | The SQL editor, not the visualizer. The clause highlight is painted by `frontend/src/site/lib/vizHistory.ts` (decoration class) with the colour in `frontend/src/site/site.css` line 278 (`.viz-clause-highlight { background: rgba(99, 102, 241, 0.22) }`) | `site.css` (shared editor styling) | No. Both files are unchanged from base `0bcf77a`. It shows here because the visualizer highlights the clause in the editor |
| V2 | `label` (critical) | `.iPadShowKeyboard` | A Monaco-internal `<input>` for the iPad on-screen keyboard has no label. Appears on touch and mobile emulation only | Monaco's own DOM; the same node appears with the editor open and nothing run (checked separately) | Third party (monaco-editor); not fixable in the visualizer | No |

No violation is in the new visualizer code: the rail, the player group, the board, the tables, the stale notice and the step bar all pass in all four configurations.

Fix hints for the owners (not applied): V1 raise the highlight contrast, for example a darker foreground for `.viz-clause-highlight` tokens in the light theme or a lighter background alpha (the bold teal needs about 4.5:1 on the blended background). V2 can only be handled by hiding the node from assistive technology from the page after Monaco mounts, or by upgrading Monaco; there is nothing to change in the visualizer.

### 3.4 Keyboard (desktop, Chrome)

Starting from the first stage button of the rail and pressing Tab 70 times:

| Check | Result |
| --- | --- |
| Rail | Stage buttons ("GROUP BY", "SUM", "ORDER BY") are reached first, each with a visible focus ring (`.vizc-step:focus-visible`, 2 px accent outline) |
| Player | `div[role=group] "Playback controls"` is one tab stop (counted exactly 1), followed by its own buttons (Restart, Previous step, Play, Next step), the speed select and the timeline; ArrowRight on the focused group moved the step from 1 to 2 |
| Board | The row board is exactly one tab stop (roving tabindex: 1 card stop in the 70 presses); the ring is drawn on the chip inside the card (`.cx-card:focus-visible > .cx-chip`, `solid 2px rgb(12, 104, 97)`; my generic probe checked the card element itself, which is why it first reported no ring) |
| Tables | Each wide table region is a tab stop with a visible ring (`.vizc-scroll:focus-visible`) |
| Focus rings elsewhere | Every other focused element in the sequence (about 40 distinct stops) showed a ring |
| Row inspector | Enter on a card opens `[data-testid=classic-inspect]`; Escape closes it (count 1 then 0) and focus returns to the card |
| Keyboard trap | None: 70 Tab presses visited 40 distinct elements, left the visualizer, passed on to the other page controls (Explain visually, Run All, Submit and so on) and the editor, and Shift+Tab moves back |

Phone keyboard behaviour was not exercised (touch emulation, no hardware keyboard).

### 3.5 Reduced motion

`reducedMotion: "reduce"` emulation, desktop and phone, at a middle step then one more Next. The player reports `data-reduced="true"`. Computed styles of every element on the page: elements with a transition longer than 1 ms or an animation longer than 1 ms: 0 (desktop) and 0 (phone); infinite animations: none. `document.getAnimations()`: 2 (desktop) and 1 (phone) animations present, none with a duration over 1 ms and none repeating.

### 3.6 Screenshots

Captured by the probe, in the session scratchpad (not copied into the repository): `<scratchpad>/a11y/<config>-middle.png`, `-stepbar.png`, `-stale.png`.

## 4. Release checklist

### 4.1 Cinema removal consistency

- No source file imports or names `QueryCinema`, `cinema.ts` or `aggDetail.ts` as a dependency: `grep -rnE "QueryCinema|cinema\.ts|/cinema[\"']|aggDetail|testid=\"cinema" frontend/src/site` returns one hit, a comment in `frontend/src/site/lib/visual/classic/aggregate.ts` line 9 that says the code is "adapted from the ideas of the Cinema's aggDetail.ts" (not an import).
- `git ls-files` lists no Cinema file, and base `0bcf77a` has none either (the Cinema was reverted there: commit `0db0b58`).
- The remaining words "Cinema" and "Query Cinema" in `src/site` are prose in copy and comments that already existed in base (for example `workspace/adapters/sql/extras.ts`, `lib/visual/dailyVisual.ts`, `components/visual/LessonVisual.tsx`, `lib/visual/story.ts`) plus the header comments of `VizViewClassic.tsx`. They are product-name text, not code. They were not changed because this gate does not edit source.
- Tests assert the absence: `siteClassicArchitecture.test.ts` (the classic layer imports no Cinema module; the Cinema files are gone), `siteSqlPracticeVizUi.test.tsx` and `siteSqlPracticeOriginalVisualizer.test.tsx` (no `cinema`, `cinema-rail`, `cinema-expand`, `cinema-empty` test ids). All pass in section 2.
- `frontend/e2e/visual.spec.ts` and `visual-engines.spec.ts` still mention "cinema" in text; they are existing files from base and are unchanged.

### 4.2 Unintended files, secrets and artifacts

- No `.env`, key, credential or `.DS_Store` file is modified or untracked. A pattern scan of every modified and untracked text file for API keys, JWTs, AWS keys, private-key headers, `service_role` and hard-coded passwords found nothing.
- Ignored local artifacts present but not part of the change: `frontend/dist-site/` (from the build in section 2), `frontend/test-results/` (Playwright output from other agents), `frontend/tsconfig.tsbuildinfo`. All three are gitignored; none will be committed.
- No file outside the SQL Practice implementation, its tests and its docs is modified or added. Compared with base `0bcf77a`, the only tracked files that differ are `frontend/src/site/entry-client.tsx` and `frontend/src/site/pages/QuestionPage.tsx`. No backend, content, `package.json`, lockfile, config or workflow file changed.
- Size to be aware of: the three untracked screenshot folders under `docs/images` now hold 135 files, about 40 MB (`sql-practice-original` 9 files, 1.3 MB; `sql-practice-visualizer` 22 files, 4.2 MB; `sql-practice-release` 104 files, 35 MB; the release folder grew from 30 files and 9.6 MB at the first pass because the browser-matrix run added screenshots). They are documentation screenshots; decide whether the release set should be trimmed before committing.
- `frontend/e2e/sql-practice-release-matrix.spec.ts` (596 lines) starts a PGlite database in the test process; it is test code only.

### 4.3 Modified tracked files

| File | Purpose |
| --- | --- |
| `frontend/src/site/entry-client.tsx` | Imports the two classic stylesheets (`classic-ui.css`, `classic-motion.css`) |
| `frontend/src/site/pages/QuestionPage.tsx` | The Visualize query tab renders `VizViewClassic` (the original visualizer); which query it shows follows the run state (`vizSource.ts`) and the stale notice |

### 4.4 Untracked files (all intended)

Source

| File | Purpose |
| --- | --- |
| `frontend/src/site/classic-ui.css` | Scoped styles of the classic visualizer (rail, tables and the `.vizc-th` header rule, step bar, scroll regions) |
| `frontend/src/site/classic-motion.css` | Scoped animation styles of the row board, with reduced-motion handling |
| `frontend/src/site/components/VizViewClassic.tsx` | Host component: runs the query once and lays out the five tabs, rail, player, board, tables and explanation |
| `frontend/src/site/components/visual/RowFlowClassic.tsx` | The original row-movement board with its inspector and one-tab-stop keyboard model |
| `frontend/src/site/components/visual/classic/ClassicExplain.tsx` | The explanation panel for the current step |
| `frontend/src/site/components/visual/classic/ClassicPlayer.tsx` | Playback controls, progress and live status for the step |
| `frontend/src/site/components/visual/classic/ClassicSql.tsx` | The SQL text with the clause for the current step highlighted |
| `frontend/src/site/components/visual/classic/ClassicStaleNotice.tsx` | The notice saying whether the view is the editor's query, the last successful run, or an earlier one |
| `frontend/src/site/components/visual/classic/ClassicStepBar.tsx` | The compact step bar that appears when the full player scrolls out of view (hardened placement logic) |
| `frontend/src/site/components/visual/classic/ClassicStepRail.tsx` | The stage rail (clickable stage buttons) |
| `frontend/src/site/components/visual/classic/ClassicTable.tsx` | One intermediate table with a keyboard-focusable sideways scroll region; column names break at underscores (`<wbr>`) |
| `frontend/src/site/components/visual/classic/ClassicTables.tsx` | The set of intermediate tables for the current step |
| `frontend/src/site/components/visual/classic/stepCopy.ts` | Plain-language fallback explanations for a step |
| `frontend/src/site/components/visual/classic/useClassicStep.ts` | Derives the single execution state (`ClassicStep`) from the playback index |
| `frontend/src/site/lib/visual/classic/contract.ts` | Shared types of the visualizer upgrade |
| `frontend/src/site/lib/visual/classic/rowTrace.ts` | Reads the real row identities from PostgreSQL for each stage |
| `frontend/src/site/lib/visual/classic/rowFlow.ts` | Builds the row-movement frames and board layout from the trace |
| `frontend/src/site/lib/visual/classic/aggregate.ts` | Group and aggregate detail (SUM lanes, groups) |
| `frontend/src/site/lib/visual/classic/order.ts` | ORDER BY sort keys and tie runs |
| `frontend/src/site/lib/visual/classic/relations.ts` | JOIN and relation parsing helpers |
| `frontend/src/site/lib/visual/classic/windows.ts` | Window-function (`OVER`) rows and values |
| `frontend/src/site/lib/visual/classic/teach.ts` | Teaching cards for each step (with the corrected rows-in count) |
| `frontend/src/site/lib/visual/classic/teachData.ts` | Types of the extra data fetched for the teaching cards |
| `frontend/src/site/lib/visual/classic/vizSource.ts` | Pure rules for which query is visualized and its status versus the editor |

Tests

| File | Purpose |
| --- | --- |
| `frontend/src/test/siteClassicArchitecture.test.ts` | Import and scoping rules: no Cinema in the classic layer, scoped CSS, only QuestionPage uses it |
| `frontend/src/test/siteClassicVisualizerData.test.ts` | Row-trace and row-flow engine over real PostgreSQL (FROM, WHERE, joins, GROUP BY) |
| `frontend/src/test/siteClassicVisualizerUi.test.tsx` | Row board rendering, animation toggle, single query run |
| `frontend/src/test/siteClassicInteraction.test.tsx` | Keyboard, rail, player, inspector and accessibility behaviour |
| `frontend/src/test/siteClassicLayout.test.tsx` | Layout, table scroll regions and header breaks, loading and empty states, step bar (13 tests) |
| `frontend/src/test/siteClassicPlayerInit.test.tsx` | Player initial state and step count |
| `frontend/src/test/siteClassicSum.test.tsx` | SUM lanes on the board |
| `frontend/src/test/siteClassicTeach.test.ts` | Teaching cards against independent expected values (65 tests, including the rows-in cases) |
| `frontend/src/test/siteSqlPracticeOriginalVisualizer.test.tsx` | Eight queries show the original visualizer, never the Cinema |
| `frontend/src/test/siteSqlPracticeVizData.test.ts` | Counts, rows and groups against independently written queries |
| `frontend/src/test/siteSqlPracticeVizUi.test.tsx` | Contract regions agree on every step; route-level checks |
| `frontend/src/test/siteSqlPracticeStale.test.ts` | Rules for which run is visualized and the stale status |
| `frontend/src/test/siteSqlPracticeStaleNotice.test.tsx` | The stale notice component |
| `frontend/e2e/sql-practice-original-visualizer.spec.ts` | Playwright: the original visualizer on the real route, desktop and phone |
| `frontend/e2e/sql-practice-visualizer-qa.spec.ts` | Playwright: layout, contrast, keyboard and regions (QA suite) |
| `frontend/e2e/sql-practice-stale.spec.ts` | Playwright: what the Visualize tab shows after runs, failures and edits |
| `frontend/e2e/sql-practice-release-matrix.spec.ts` | Playwright: browser-matrix checks for the release |

Docs

| File | Purpose |
| --- | --- |
| `docs/SQL_VISUALIZER_ORIGINAL_ARCHITECTURE.md` | How the original visualizer was built, recovered from history |
| `docs/SQL_VISUALIZER_UPGRADE_CONTRACT.md` | The shared contract (test ids, step state) the agents built to |
| `docs/SQL_PRACTICE_ORIGINAL_VISUALIZER_RESTORATION.md` | What was restored and why |
| `docs/SQL_PRACTICE_VISUALIZER_QA_REPORT.md` | QA report: strategy, baseline, findings |
| `docs/SQL_PRACTICE_RELEASE_VERIFICATION.md` | This document |
| `docs/images/sql-practice-original/` | 9 screenshots for the restoration doc |
| `docs/images/sql-practice-visualizer/` | 22 screenshots for the QA report |
| `docs/images/sql-practice-release/` | 104 screenshots of the release matrix (35 MB) |

### 4.5 Release verdict

Gates: TypeScript, ESLint, full Vitest (8483 passed, 0 failed, 10 skipped with the Python venv), production build and prerender check all pass. The 1187 failures seen without a venv are environmental and identical on the base commit (section 1). Open items for the owners before shipping: V1 (Monaco clause-highlight contrast in the light theme, pre-existing, `site.css`), V2 (Monaco `.iPadShowKeyboard` unlabeled input, third party), and the decision on the 40 MB of screenshots in `docs/images`. Nothing was deployed, committed or pushed.
