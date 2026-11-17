# Visual Learning Engine V2: shared brief for every agent

Repository worktree: `/Users/subramanyaacharya/Downloads/project/sql-practice-platform-integration` (frontend in `frontend/`). Branch `feature/visual-learning-engine`. It holds a large amount of **uncommitted V1 work that must not be lost**.

## Hard rules (all agents)

1. **No git write commands at all**: no commit, add, reset, checkout, switch, stash, clean, restore, rebase, merge, push. `git status`, `git diff` and `git log` (read only) are fine.
2. **Only edit the files you own** (table below). Create new files only inside your owned paths. If you need a change in a file you do not own, do not make it: describe it in your final report and the main agent applies it.
3. Do not touch `routes.tsx`, `lib/navigation.ts`, `pages/VisualPages.tsx`, `pages/DailyPages.tsx`, `components/daily/LessonUi.tsx`, `components/visual/Playback.tsx`, `components/visual/VisualHelp.tsx`, `lib/visual/playback.ts`, `lib/visual/motion.ts`, `lib/visual/helpContent.ts` (owned by the help agent, content only) unless the table says you own them.
4. Other agents are editing other files at the same time in the same directory. A TypeScript or lint error in a file you do not own is not yours; do not fix it. Run `npx tsc --noEmit -p .` and filter its output to your own files. Run only **your** targeted Vitest files (`cd frontend && TZ=UTC npx vitest run src/test/<yourfile>`). **Do not run the full Vitest suite, the build, or Playwright** (agent 10 owns Playwright; the main agent owns full validation), except where your task below says otherwise.
5. Existing behaviour must keep working: SQL/Python grading, Daily Learning progress, Mistake Notebook, study-time analytics. The 270 lesson files in `frontend/src/site/content/daily/days/` must not be edited.
6. **Honesty labels**: every view is one of Executed (real run), Parsed, Plan, Estimated, Conceptual model, Simulated. Use `ProvenanceBadge` from `components/visual/Playback.tsx` (`p="executed" | "parsed" | "plan" | "estimated" | "conceptual" | "simulated"`). Never invent runtime data and never present a simulation as a real system. State limits in the UI.
7. No new npm dependency. No network requests, no server-side execution, no AI service. Learner code is never stored or sent anywhere.
8. Match the code style of `frontend/src/site/lib/visual/*` and `components/visual/*` (Tailwind tokens such as `text-ink`, `bg-surface-soft`, `border-surface-border`; `Card`/`Badge` from `components/ui`; comments explain why). Dark and light themes both must work (use the token classes, never hard-coded colours except chart fills). Accessible: labels, roles, keyboard operation, `aria-live` for step descriptions. Layout works at 390 px width without horizontal scroll.
9. Every module uses the shared player where it has steps: `usePlayback`, `PlaybackBar`, `VisualShell`, `ProvenanceBadge` from `components/visual/Playback.tsx`; pure logic in `lib/visual/*.ts` (no React) so it is unit-testable in node.
10. Write tests for what you build (Vitest; node tests start with `// @vitest-environment node`; component tests use Testing Library like `src/test/siteVisualUi.test.tsx`). Tests must assert real behaviour, not just rendering. Do not weaken or delete existing tests.
11. Final report (short, plain): files created/changed, tests added and their pass counts, what you verified and how, what remains limited or unverified. Do not claim anything you did not run.

## Contracts already in place (main agent)

- Page shell: `pages/VisualPages.tsx` already routes `/visual/tree|graph|excel|linux|git|stats|business|interview` to placeholder components `components/visual/{TreeExplorer,GraphExplorer,ExcelLab,LinuxLab,GitLab,StatsLab,BusinessLab,InterviewLab}.tsx`. Each exports a component with props `{ preset?: string }` (a lesson links with `?preset=<id>`). Keep that export name and prop. Replace the placeholder body. Export a `PRESETS` list (ids and labels) from the corresponding `lib/visual/<name>.ts` so lessons can reference them.
- Help: `<VisualHelp id=… />` is already rendered by every page and by the SQL visualizer page. Its content lives in `lib/visual/helpContent.ts` (`HELP[id]`), written by the help agent.
- Reduced motion: `useReducedMotion()` from `lib/visual/motion.ts` (true when the OS asks for reduced motion or the learner chose it with `MotionToggle`). Any movement or transition you add must be disabled when it is true.
- SQL stages: `Stage.setOp?: SetOpData` (`lib/visual/setOps.ts`) is filled by `lib/visualize.ts` and drawn by `components/visual/SetOpView.tsx`; `components/visual/RowFlow.tsx` receives `{ stage, prev, reduced }` and is mounted in `components/VizView.tsx` above the stage details. Both files are placeholders to replace.
- Python trace: public API of `lib/visual/pyTrace.ts` is `buildTraceProgram`, `parseTrace`, `traceRun`, `Trace`, `changedVars`, `lineCounts`, `memoryAt`, `describeStep`, `costNotes`. You may add to it; do not break existing callers (`components/visual/PythonTimeMachine.tsx`, `src/test/siteVisualPyTrace.test.ts`).
- Lesson mapping: `lib/visual/dailyVisual.ts` has all 14 template kinds. `visualFor({title, topics, lang})` returns a template; the lesson page shows its `route` as a "Visual helper" link.

## Ownership

| # | Agent | Owns (exclusive) |
| --- | --- | --- |
| 1 | Trace scalability | `lib/visual/pyTrace.ts`, `lib/visual/traceStore.ts` (new), `components/visual/PythonTimeMachine.tsx`, `src/test/siteVisualPyTrace.test.ts`, `src/test/siteVisualTraceScale.test.ts` |
| 2 | SQL set operations | `lib/visualize.ts`, `lib/sqlAst.ts`, `lib/sqlClauses.ts`, `lib/visual/setOps.ts`, `components/visual/SetOpView.tsx`, `src/test/siteVisualSetOps.test.ts` |
| 3 | SQL row animation | `components/VizView.tsx`, `components/visual/RowFlow.tsx`, `lib/visual/rowFlow.ts`, `lib/visual/rowTrace.ts`, `components/visual/MotionToggle.tsx`, `src/test/siteVisualRowFlow.test.ts*` |
| 4 | Tree Explorer | `components/visual/TreeExplorer.tsx`, `lib/visual/tree.ts`, `src/test/siteVisualTree.test.ts*` |
| 5 | Graph Explorer | `components/visual/GraphExplorer.tsx`, `lib/visual/graph.ts`, `src/test/siteVisualGraph.test.ts*` |
| 6 | Excel and Linux | `components/visual/ExcelLab.tsx`, `components/visual/LinuxLab.tsx`, `lib/visual/excel.ts`, `lib/visual/linux.ts`, `src/test/siteVisualExcel.test.ts*`, `src/test/siteVisualLinux.test.ts*` |
| 7 | Git and Interview | `components/visual/GitLab.tsx`, `components/visual/InterviewLab.tsx`, `lib/visual/git.ts`, `lib/visual/interview.ts`, `src/test/siteVisualGit.test.ts*`, `src/test/siteVisualInterview.test.ts*` |
| 8 | Statistics and Business | `components/visual/StatsLab.tsx`, `components/visual/BusinessLab.tsx`, `lib/visual/stats.ts`, `lib/visual/business.ts`, `src/test/siteVisualStats.test.ts*`, `src/test/siteVisualBusiness.test.ts*` |
| 9 | Coverage and Help | `lib/visual/dailyVisual.ts`, `lib/visual/helpContent.ts`, `docs/VISUAL_LEARNING_COVERAGE.md`, `src/test/siteVisualCoverage.test.ts`, `src/test/siteVisualHelp.test.tsx`, `scripts/visual-coverage.mjs` |
| 10 | Browsers and equivalence | `frontend/playwright.config.ts`, `frontend/e2e/visual*.spec.ts` and `frontend/e2e/visual-*.spec.ts`, `src/test/siteVisualEquivalence*.test.ts*`, `src/test/siteSupabaseSync*.test.ts*`, `docs/VISUAL_BROWSER_MATRIX.md` |

The main agent owns everything else, including `docs/VISUAL_LEARNING_REPORT.md` and `docs/VISUAL_LEARNING_PLAN.md`, `Playback.tsx`, `VisualHelp.tsx`, routes, navigation and pages.
