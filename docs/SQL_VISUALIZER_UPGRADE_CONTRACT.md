# SQL Practice visualizer upgrade: shared contract

Coordinator document. Five agents work in this one worktree (`sql-practice-platform-sqlviz`, branch `feature/sql-visualizer-restore`) at the same time. This file says who owns what, so nobody overwrites anybody.

## Foundation

The foundation is the original SQL visualizer, as restored in `docs/SQL_PRACTICE_ORIGINAL_VISUALIZER_RESTORATION.md`:

| Part | File |
| --- | --- |
| Host component (used by `QuestionPage.tsx` only) | `frontend/src/site/components/VizViewClassic.tsx` |
| Row-movement board | `frontend/src/site/components/visual/RowFlowClassic.tsx` |
| Row data and frames | `frontend/src/site/lib/visual/classic/rowFlow.ts`, `classic/rowTrace.ts` |
| Stage counts and samples | `frontend/src/site/lib/visualize.ts` (shared, read-only) |

Improve these. Do not replace them, do not add the SQL Query Cinema, do not add a second SQL engine, a second playback system or a competing visualizer component.

## The one execution state

Everything on screen renders from one `ClassicStep` (`lib/visual/classic/contract.ts`), derived by `useClassicStep` (`components/visual/classic/useClassicStep.ts`) from the playback index. The SQL highlight, the row board, the intermediate tables, the explanation and the progress indicator must all read it and nothing else. If a component needs another fact, the fact is added to `ClassicStep` through the coordinator, not computed on the side.

## Ownership

An agent edits only the files it owns. Files marked read-only are shared with the Cinema, the workspace or other visualizers.

| Owner | Files (create or edit) |
| --- | --- |
| Agent 1: original and architecture | `docs/SQL_VISUALIZER_ORIGINAL_ARCHITECTURE.md`, `frontend/src/test/siteClassicArchitecture.test.ts` |
| Agent 2: execution data and teaching | `frontend/src/site/lib/visual/classic/rowFlow.ts`, `rowTrace.ts`, `teach.ts`, any new `lib/visual/classic/*.ts` except `contract.ts`; tests `frontend/src/test/siteClassicTeach*.test.ts` |
| Agent 3: UI and UX | `frontend/src/site/components/VizViewClassic.tsx`, new files in `frontend/src/site/components/visual/classic/` other than `useClassicStep.ts`, `ClassicSql.tsx`, `ClassicPlayer.tsx`; `frontend/src/site/classic-ui.css` |
| Agent 4: motion, interaction, accessibility | `frontend/src/site/components/visual/RowFlowClassic.tsx`, `components/visual/classic/useClassicStep.ts`, `ClassicSql.tsx`, `ClassicPlayer.tsx`; `frontend/src/site/classic-motion.css`; tests `frontend/src/test/siteClassicInteraction*.test.tsx` |
| Agent 5: QA | all other new tests (`frontend/src/test/siteSqlPracticeViz*.test.*`), `frontend/e2e/sql-practice-visualizer-qa.spec.ts`, the existing classic tests (`siteClassicVisualizerData.test.ts`, `siteClassicVisualizerUi.test.tsx`, `siteSqlPracticeOriginalVisualizer.test.tsx`, `e2e/sql-practice-original-visualizer.spec.ts`), `docs/SQL_PRACTICE_VISUALIZER_QA_REPORT.md`, `docs/images/sql-practice-visualizer/` |
| Coordinator | `lib/visual/classic/contract.ts`, this file, `entry-client.tsx`, the final integration and the final report |

Read-only for everyone (shared with other pages): `lib/visualize.ts`, `lib/sqlClauses.ts`, `lib/sqlAst.ts`, `components/visual/Playback.tsx`, `lib/visual/playback.ts`, `lib/visual/motion.ts`, `components/visual/RowFlow.tsx`, `QueryCinema.tsx`, `lib/visual/cinema.ts`, `aggDetail.ts`, `lib/visual/rowFlow.ts`, `lib/visual/rowTrace.ts` (the Cinema's), `site.css`, `pages/QuestionPage.tsx`, `pages/QueryVisualizerPage.tsx`, the SQL practice editor and result panels, everything for Python, Pandas, NumPy, the workspace, progress and grading, `supabase/`. If a read-only file must change, stop and report it; the coordinator decides.

## Interfaces between agents

These signatures exist now as working starter code. The owner improves the body and keeps the signature. A change to a signature goes through the coordinator.

```ts
// Agent 2
buildTeach(viz: Visualization, trace: RowTrace | undefined, stageIndex: number): TeachCard
teachSteps(viz: Visualization, trace: RowTrace | undefined): TeachCard[]
// frames: trace.frames[i] stays a FlowFrame; new frame kinds are added to classic/rowFlow.ts and drawn by Agent 4's RowFlowClassic

// Agent 4
useClassicStep(viz, trace, pb: { index: number; count: number; playing: boolean }): ClassicStep | null
<ClassicSql sql range? clause? />
<ClassicPlayer pb labels? />
<RowFlow stage prev reduced frame stageIndex speed refining />      // RowFlowClassic.tsx; new props must be optional

// Agent 3 consumes all of the above in VizViewClassic.tsx
```

Agent 3 wires the host once from the starter versions, so it never waits for the others. Agents 2 and 4 improve their modules behind the same signatures; the host picks the improvements up without changes.

## Rules

1. Real data only. Every intermediate table, count and value comes from the database run (`visualize()` and the classic `traceRows`, read-only SELECT, WITH and EXPLAIN). Nothing is typed in, mocked or computed to look right. Label conceptual (logical-order) steps as logical order, never as PostgreSQL's physical plan.
2. Do not change the learner's query run. It still runs exactly once.
3. Motion: use the `--motion-*` and `--ease-*` tokens in `site.css`, animate `transform` and `opacity` only, never `transition: all`, no infinite decorative animation, honour reduced motion (`useReducedMotion`, the in-page `MotionToggle`).
4. Themes: use the site's theme tokens (`bg-surface`, `text-ink`, ...). No hard-coded dark or light colours. Check both themes.
5. Do not touch Python, Pandas or NumPy visualizers, the Cinema, SQL problem pages, authentication, database schemas, routes or dependencies.
6. Do not run `git commit`, `push`, `merge`, `rebase`, `reset`, `checkout` of files, `stash`, or any deploy. Do not delete files you did not create. Other agents' uncommitted work is in the same tree.
7. Type checking: `cd frontend && npx tsc --noEmit -p tsconfig.json`. Lint: `npx eslint <your files>`. Tests: run only your own test files, `TZ=UTC npx vitest run <files>`. Do not run the whole suite (the coordinator does).
8. Dev servers, if you need one: `cd frontend && npx vite --config vite.site.config.ts --port <your port> --strictPort`. Ports: Agent 1 5185, Agent 2 5181, Agent 3 5182, Agent 4 5183, Agent 5 5184. Stop it when you finish.
9. Report: when done, list every file you created or changed (one line each), what you verified and how, what you could not do, and anything another agent must know.

## Stable test ids and the synchronisation marker

Agent 5 writes its tests against these names, so each owner adds them exactly. Every region that shows the current step carries `data-step-index="<n>"` (the `ClassicStep.index`), so a test can read all five regions and check they agree.

| Test id | Element | Owner | Required attributes |
| --- | --- | --- | --- |
| `classic-viz` | root of the visualizer | Agent 3 | `data-step-index`, `data-step-count` |
| `classic-step-rail` | the FROM → JOIN → ... step navigation (a list of buttons, `aria-current="step"` on the active one) | Agent 3 | `data-step-index` |
| `classic-explain` | what is happening / what changed / why / what to remember | Agent 3 | `data-step-index` |
| `classic-tables` | the input and output intermediate tables of the step | Agent 3 | `data-step-index` |
| `classic-sql` | the query text with the active clause marked (`<mark>`) | Agent 4 | `data-step-index`, `data-range="start,end"` |
| `classic-progress` | the progress indicator (`role="progressbar"`, `aria-valuenow` = step number, `aria-valuemax` = steps) | Agent 4 | `data-step-index` |
| `rowflow`, `rowflow-board` | the row-movement board (existing ids stay) | Agent 4 | `data-step-index` on `rowflow` |
| `classic-inspect` | the row-inspection panel (one row's column values) | Agent 4 | none |
| `classic-reset` | the Reset button | Agent 3 | none |

Existing ids and roles stay: the tabs (`role="tab"` Logical steps, Flow diagram, Relationships, Structure, Execution plan), the playback group (`role="group"`, name "Playback controls") with buttons named Restart, Previous step, Play, Pause, Next step, and `rowflow-identity`, `rowflow-live`.
