# Unified Exercise Workspace: architecture (Agent 1)

Owner: Agent 1 (shared architecture). Contract: `frontend/src/site/workspace/types.ts`. Coordination and file ownership: `WORKSPACE_COORDINATION.md`.

## Adapter module convention (for Agents 2, 3, 4)

The registry finds adapters with `import.meta.glob("./adapters/*/index.{ts,tsx}")`. A folder that does not exist yet simply means "not available". Folder to domain map:

| Folder | Domains it serves |
| --- | --- |
| `adapters/sql/index.ts` | `sql` |
| `adapters/python/index.ts` | `python` |
| `adapters/data/index.ts` | `pandas` and `numpy` (two domains, one module) |

Each `index.ts` exports (named exports, no default needed):

```ts
import type { AdapterModule } from "../../types";
export const adapterModule: AdapterModule = {
  getAdapter(domain) { /* return the ExecutionAdapter for that domain; data returns a pandas or numpy adapter */ },
  Visualizer, // optional React component receiving VisualizerProps
};
```

Also accepted, for convenience: a named `getAdapter` / `Visualizer`, or a named `adapter` (one `ExecutionAdapter`), or `default`. Keep the module light: heavy engines (Pyodide, PGlite) must stay behind the adapter's own lazy imports, because the registry imports the module only when an exercise of that domain opens.

Rules the workspace relies on: `capabilities` lists only what really works; `run` never grades; `validate` goes through the existing grading code; `visualize` returns `null` (and `limitations` says why) instead of fabricating steps; the workspace passes an `AbortSignal` in `RunContext.signal` and ignores results that arrive after an abort.

## 1. Audit of what exists (what the workspace reuses, and what it does not)

| Existing piece | What it is | How the workspace uses it |
| --- | --- | --- |
| `components/CodeEditor.tsx` | Monaco editor (SQL or Python), Ctrl/Cmd+Enter, error-line marker, needs `ThemeProvider` | Lazy-loaded by `panels/EditorPanel.tsx`. A plain `<textarea>` is the fallback while it loads, if it fails, and for `editor="plain"` |
| `components/PythonWorkspace.tsx` (793 lines) | Python file tree, run, check, test counts, restore. Tied to `PythonTask` | Not reused as a component (it is page-specific and owned by the coordinator). Its grading call `runPythonTask` (`lib/tasks.ts`) is what the Python adapter must call |
| `components/PracticePanel.tsx` (516 lines) | SQL editor, tabs, run, submit, plan, progress calls | Not reused as a component. Its non-lesson progress calls (`recordAttempt`, `recordMistake`, `noteAttempt`, `noteExecution`) are the model for `progressPort.ts` |
| `components/SampleTable.tsx` | Read-only result table | Results panel (up to 100 rows) |
| `components/HintLadder.tsx` | SQL five-level help built from a `Question` | `solutionSkeleton` is reused for the level 3 "partial structure". The ladder UI is generalised in `panels/ExplanationPanel.tsx` (same five levels, same "assisted" rule) |
| `lib/visual/explain.ts` | Rule-based Explain levels (concept, hint, visual, detailed, solution) built from a real run | Kept as is; the host may still show it. The workspace ladder is the exercise's authored help, not generated text |
| `components/visual/Playback.tsx`, `lib/visual/playback.ts` | The one shared player (reducer, bar, keyboard) | `usePlayback` and `PlaybackBar` are used unchanged by `useExerciseSession` and `VisualizationPanel` |
| `components/visual/MotionToggle.tsx`, `lib/visual/motion.ts` | Reduced-motion preference (system, reduce, full) | `useReducedMotion()` feeds `VisualizerProps.reducedMotion`; `MotionToggle` sits in the Visualization panel |
| `components/ui.tsx` | `Tabs` (roving arrows), `Difficulty`, `Chip` | Mobile tab strip, problem header |
| `react-resizable-panels` (already a dependency) | Resizable panes with a keyboard-operable handle | Desktop split |
| `lib/progress.ts`, `lib/pyPractice.ts`, `lib/mistakes.ts`, `lib/solveSessions.ts`, `lib/dailyProgress.ts` | The only progress stores | Called only by `progressPort.ts`; a test pins its import list |
| `lib/sqlRunner.ts` (`submit`), `lib/resultCompare.ts` | SQL grading | Called by the SQL adapter (Agent 2), not by the core |

### Dependency map

```
host page ─► EmbeddedExercise ─► sources/loadExerciseById ─► lib/data, lib/pyExercises, lib/daily   (content, read only)
                   │
                   └────────────► ExerciseWorkspace ─► useAdapter ─► registry ─► adapters/<folder>/index.ts (lazy, by glob)
                                        │                                           └─► existing runners: PGlite worker, Pyodide worker
                                        ├─► useExerciseSession ─► ProgressPort ─► progressPort.ts ─► lib/progress | pyPractice | mistakes | solveSessions
                                        │         └─► usePlayback (components/visual/Playback)
                                        └─► panels: Problem, Editor (CodeEditor), Results (SampleTable), Visualization (adapter's Visualizer), Explanation
```

## 2. Contract changes (all additive; v0 names and shapes are unchanged)

- `Validation`: `sql-result.orderBy` (the reference query's ORDER BY keys), `python-tests.hidden` (hidden tests, run only after the visible ones pass).
- `ExerciseDef`: `topicLabel`, `category` (Python category, used as the Mistake Notebook topic), `rubric`, `minutes`; `dataset.id`.
- `HintLevel` type. Levels 1 to 4 are `ExerciseDef.hints`; level 5 is `ExerciseDef.solution`, never a hint.
- `AdapterModule` (see the convention above).
- `ProgressPort.recordAttempt(ex, passed, errorKind?, code?)` gained `code`; new optional `recordRun`.

## 3. Behaviour the tests pin

- **Capabilities decide controls.** Run needs `run`; Submit needs `submit` plus `validate` plus a graded exercise; Visualize needs `visualize` plus one of `stages`, `trace`, `beforeAfter`, `shapes`, `plan`, `compare`; Play, Pause, Step, Restart and Speed need one of `stages`, `trace`, `beforeAfter`, `shapes` and a model with steps. A plan-only adapter shows its view without a player.
- **Nothing is earned by looking.** Opening a workspace, running, opening a hint, or visualizing never marks anything solved. Only a graded Submit calls `recordAttempt`. A failed run is filed as a "not graded" mistake via `recordRun`.
- **Help is on request.** Hints and the solution are not in the DOM until opened. Levels open one at a time (missing levels are skipped). The solution asks for a second confirmation while unsolved. After a pass the reference solution is one click away and costs nothing.
- **Abort.** Every run, submit and visualize has an `AbortSignal`. Stop, Reset, a newer run, switching exercise and unmount abort it, and a late result is discarded and not recorded. A grader that throws is shown as "checker could not finish" and is not recorded as a wrong answer.
- **Reset** restores the starter code and clears results, feedback and visuals. It keeps the hint level (help already used is a fact).
- **Layout.** Desktop (1024px and up): resizable two-column split, every pane collapsible, Visualization collapsed by default and height-limited (60vh) so it cannot push the editor away. Phones: five tabs (Problem, Editor, Visualization, Results, Explanation), Run jumps to Results. Compact hosts (lessons) stack on desktop and start with help closed. The server and first render use tabs, so hydration always matches.

## 4. Sources and ids

`sql:<slug>`, `py:<slug>`, `daily:<dayId>#<exerciseId>` (the same ref the Mistake Notebook uses). Converters are pure. Hints: level 1 concept; Python and Daily authored hints go to levels 2 to 4 (1 hint: level 2; 2 hints: 2 and 4; 3 or more: first at 2, middle at 3, last at 4); SQL uses `approach` (2), a solution skeleton (3), `why` plus pitfalls (4). An authored hint that contains the entire solution is dropped from levels 1 to 4 (17 of 3,177 Daily hints today, all last hints), so the solution stays level 5.

Daily difficulty has no source field: guided is shown as Easy and independent as Medium. Written exercises are not converted. Daily Python exercises that import pandas or numpy get that domain.

## 5. Not done, by design or by ownership

- No page is wired (coordinator). The existing Check buttons and the workspace write the same stores, so they can coexist.
- The SQL solve timer (`SolveTimer`, `openSession`) belongs to the host page. The port calls `noteAttempt` and `noteExecution`, which do nothing without an open session.
- Monaco was checked in a real browser (Chrome) in a throwaway demo; the jsdom tests use the plain editor. Firefox and WebKit were not run.

---

## Phase 2 additions (coordinator, 2026-11-18)

### Contract additions (all additive, `workspace/types.ts`)

- `SqlPolicy` (`read-only`, `own-tables`, `own-data`) and `ExerciseDef.sqlPolicy`. The SQL adapter derives it from the reference query when absent; see `WORKSPACE_SQL_SAFETY.md`.
- `DebugNote`, `ExerciseDef.debugging`, `constraints`, `realWorld`.
- `ExerciseEnrichment`: teaching content by exercise id, stored in `content/workspace/enrichment/*.json` and merged by `workspace/sources/enrichment.ts` inside `loadExerciseById`. `loadBaseExerciseById` returns the converter output alone. Enrichment never changes `validation`, `starterCode` or `solution.code` (tested). A bad item is ignored whole by `enrichmentProblems`.
- `ExecutionAdapter.reset?`, `ExecutionAdapter.visualizeOnError?`, `VisualizerProps.hostPlayer?`, `ExerciseDef.readOnly?` (alias) and `ExerciseDef.files?`.

### Hint model

Levels 1 to 4 come from content (1 concept, 2 syntax or concept to use, 3 approach, 4 structured steps with the key expression left to the learner). Level 5 is the stored solution and is only shown on request, behind a confirm step. The brief lists five hint ideas before the solution; "partial implementation" and "near-complete guidance" are merged into level 4 so the five-slot ladder pinned by the core tests stays unchanged.

### Progress ports (one store per domain, no new store)

- `createProgressPort` handles SQL questions and Python exercises (`lib/progress.ts`, `lib/pyPractice.ts`, `lib/mistakes.ts`).
- `createDailyPort` (`workspace/dailyPort.ts`) makes exactly the writes the Daily lesson page makes, through shared functions in `lib/dailyExercise.ts` that the legacy lesson runner also calls. The default `storeProgressPort` routes Daily exercises to it, so `/workspace?e=daily:...` and the lesson leave identical records.
- Opening, running, hints and visualizing never record a pass. Only a graded check does.

### Where the workspace is the exercise UI

- Daily Learning lessons: `components/daily/EmbeddedDailyExercise.tsx` mounts `EmbeddedExercise` for graded Python, pandas, NumPy and SQL exercises. Written exercises, `python local` and `bash run` examples keep their existing UI. The legacy runner remains as a fallback when the engine or the SQL policy checker cannot run an exercise.
- `/visual/data`: `components/visual/DataStudio.tsx` runs the learner's code through the data adapter and renders `DataVisualizer`.
- `PythonWorkspace` and the old trace viewer share `components/visual/PyTracePanels.tsx` with the workspace's Python visualizer.
- Learn hub topics, path pages, project tasks and scenarios link to real exercises through `lib/workspaceLinks.ts`.
- SQL question pages run under the exercise's derived SQL policy (`PracticePanel` passes `{ policy }` to `runQuery` and `submitQuery`). The Playground and Learn lessons stay unrestricted.

### Not done by design

- Daily written exercises are not embedded.
- The workspace is not the page body of `QuestionPage` or `PythonExercisePage`. Those pages keep the solve timer, draft saving and analytics, and link to the workspace.
