# DataForge Guide: contextual help, tours and onboarding

Branch `feature/dataforge-guide` (worktree `../sql-practice-platform-guide`), from `origin/main` `60f29ca`. Not pushed, not merged, not deployed.

## Architecture (all under `frontend/src/site/help/`)

| Piece | File | Role |
| --- | --- | --- |
| HelpRegistry | `registry.ts`, `registryLoader.ts`, `content/*.ts` | Section help as local data. Dropping a file in `content/` registers it (`import.meta.glob`). Code-split: loaded the first time help, search or a tooltip is used |
| HelpPanel | `HelpPanel.tsx`, `HelpButton.tsx`, `HelpProvider.tsx` | Right-hand drawer (bottom sheet on phones) with 9 blocks, section tabs, Help Center |
| HelpSearch | `search.ts`, `HelpSearch.tsx` | Local ranked search over sections, controls, concepts, errors, workflows, tutorials, glossary |
| HelpTooltip | `HelpTooltip.tsx` | `<HelpTooltip id label/>` beside complicated controls; text from the glossary |
| GuidedTour | `GuidedTour.tsx` | Spotlight + step card, Next/Previous/Skip/Finish, progress, mobile bottom card |
| HelpProgress | `progress.ts` | localStorage `df.help.v1`: onboarding and per-tour status |
| Onboarding | `Onboarding.tsx` | First-visit, non-blocking welcome card; skip and replay |
| Try Example | `exampleBridge.ts` | Editors register a listener; the panel loads examples without overwriting learner code |

No AI service, no network call, no new dependency. `HelpProvider` is mounted inside `SiteLayout`, which also holds the one `? Help` button, so every page has the same button in the same place.

## Content contract

Each content module exports `{ sections, glossary }` (`types.ts`). Rules every author follows:

1. **Real things only.** Control names are the labels on screen (the test searches app source for them). Routes come from `routes.tsx`. Links to questions, notes, scenarios, projects and lessons must be real slugs (`src/test/helpValidate.ts` checks).
2. **Examples are executed.** SQL examples carry `expectedRows`, Python examples carry `expectedStdout`; `siteHelpExamples.test.ts` runs them (PGlite, CPython) and `scripts/help-examples-verify.ts` runs Python in real Pyodide.
3. **Plain words.** Written for a beginner who has not seen the page. Short sentences. No unexplained jargon.
4. **Tours** have 5-9 steps; each `target` is a selector list resolved on the real page. A step with no match still shows (centred) and says so.
5. Where a section's page is not in this tree (the Visual Learning Engine pages), mark the section `pending: "feature/visual-learning-engine"`.

## Ownership (one writer per file)

| Owner | Files (write) | Reads, never edits |
| --- | --- | --- |
| Guide core (HelpRegistry, HelpPanel, HelpSearch, GuidedTour) | everything in `help/` except `content/*`, `SiteLayout.tsx`, `Settings` panel, `siteHelp*.test.*`, `e2e/help.spec.ts`, this doc | |
| Content: SQL | `help/content/sql.ts` | |
| Content: Python | `help/content/python.ts` | |
| Content: Data engineering | `help/content/data-engineering.ts` | |
| Content: Learning and progress | `help/content/learning.ts` | |
| Content: Visual engine | `help/content/visual.ts` | the visual branch files |
| Platform guide | `help/content/platform.ts` | |

`data-help="..."` attributes and `<HelpTooltip>` placements are the only edits content owners may make to page files, and only to files **not** modified by the Visual Learning Engine branch. Those nine files are off limits here; selectors and tooltips for them are listed under "Pending hooks" below and applied on the integration branch by its owner:
`PlanTree.tsx`, `VizView.tsx`, `daily/LessonUi.tsx`, `lib/navigation.ts`, `pages/DailyPages.tsx`, `pages/PythonPracticePages.tsx`, `pages/QueryVisualizerPage.tsx`, `pages/QuestionPage.tsx`, `routes.tsx`.

Shared files the guide core touches once: `SiteLayout.tsx` (Help button, provider), `pages/SettingsPage.tsx` (replay panel). Nothing else is shared.

## Coordination with the Visual Learning Engine agents

Their routes (`/visual`, `/visual/python`, `/visual/data`, `/visual/api`, `/visual/etl`, `/visual/charts`) exist only on `feature/visual-learning-engine` (uncommitted when this was written). `content/visual.ts` documents them from that tree (read-only) and is marked `pending`. When that branch merges: delete the `pending` flags (a tripwire test fails until then), add `data-help` attributes and `useHelpExample` hooks listed below, and re-run the tour check in `e2e/help.spec.ts`.

## Behaviour notes

- **Help button**: one `? Help` in the header on every page (icon only on phones). `?` opens it outside text fields. Help follows the page; a section picked from search stays until navigation.
- **Search**: ranked local matcher (prefix, synonyms, category filters: Features, Concepts, Buttons, Workflows, Common errors, Tutorials). A result opens that section's help at the matching control, topic or term.
- **Tours**: a tour or a single step can name a `route`; the tour then moves the learner to that page itself. A step whose element is not on screen (needs data, needs an action first, hidden at this width) shows centred with a note instead of failing. Finished and skipped tours are remembered in `localStorage` key `df.help.v1`; Settings and Help Center restart them.
- **Welcome card**: first visit only, 1.2 s after load, non-blocking, never on login pages; Skip is always visible. Existing browser tests pre-mark it seen (`e2e/fixtures.ts`); `e2e/help.spec.ts` opts back in.
- **Try Example**: never replaces learner code silently. Python loads into a new `help_example.py` file; the SQL playground and ETL builder ask first when their content may be the learner's; pages without an editor navigate to one and load into the freshly mounted editor. Every example also has Copy code.
- **Tooltips**: the accessible name of a `HelpTooltip` must not contain a button or link name used by browser tests (a unit test enforces it).

## Verification (2026-11-12)

See the final report in the session. Commands: `npx vitest run src/test/siteHelp*.test.*`, `E2E_BASE_URL=http://localhost:<port> npx playwright test e2e/help*.spec.ts` (start `npm run dev:site -- --port <port>` from this worktree; port 5174 may serve another tree), `npx vite-node scripts/help-examples-verify.ts` (Python examples in real Pyodide).

## Pending hooks (filled in by the content authors)

### Python
`pages/PythonPracticePages.tsx` is off limits, so these are not applied yet. The tour uses `main article` for step 1 and the workspace hooks for the rest, so nothing breaks without them. Suggested, when that file is next edited on the integration branch:
- `data-help="py-problem"` on the `<article>` (problem text), `data-help="py-hints"` on the Hints `<section>` and `data-help="py-tests-visible"` on the "Show the tests" `<details>`.
- `data-help="py-difficulty"` on the Difficulty badge row and `data-help="py-stage"` on the "Stage N: ..." badge.
- `<HelpTooltip id="complexity-o-n" label="What does O(n) mean?" />` after "Expected complexity" in the Solution explanation, and `<HelpTooltip id="visible-vs-hidden-tests" ... />` beside "Show the tests".
- On the list page: `data-help="py-filters"` on the Problems filter row and `<HelpTooltip id="pyodide" ... />` in the intro.
Already applied in `PythonWorkspace.tsx` / `PythonAssessmentPage.tsx`: `py-workspace`, `py-files`, `py-editor`, `py-run`, `py-check`, `py-output-tab`, `py-tests-tab`, `py-stdin-tab`, `py-console`, `py-assess-start`, `py-assess-timer`, `py-assess-check`; tooltips `pyodide`, `check-tests`, `stdin-input`, `visible-vs-hidden-tests`. Try Example loads into a new `help_example.py` tab (kept in the workspace's saved files; solution.py and graded checks never see it).

### Visual engine

Owner: the `feature/visual-learning-engine` branch, applied on merge. Content is `help/content/visual.ts` (all sections `pending`). Until then its tours use aria-label, role and button-text selectors read from that branch's source (never tested on a live page). After the hooks below exist, switch tour `target`s to `[data-help="..."]`.

Shared (`components/visual/Playback.tsx`):
- `data-help="viz-playback"` on the `<div role="group" aria-label="Playback controls">` in `PlaybackBar`.
- `data-help="viz-timeline"` on the `<input type="range" aria-label="Timeline">` and `data-help="viz-speed"` on `<select aria-label="Playback speed">`.
- `<HelpTooltip id="provenance-badge" label="What do these labels mean?" />` beside the `ProvenanceBadge` in each visualizer header row (not inside every badge).

Hub (`pages/VisualPages.tsx`, `VisualHubPage`): `data-help="viz-hub-cards"` on the cards `<ul>`; `data-help="viz-card-python"` on the Python Code Time Machine `<Link>` and `data-help="viz-card-sql"` on the SQL Query Cinema `<Link>`.

Python and data (`components/visual/PythonTimeMachine.tsx`, `pages/VisualPages.tsx` `CodeLab`):
- `data-help="viz-presets"` on the preset button row; `data-help="viz-py-editor"` on the `CodeEditor` wrapper (label "Python code to trace").
- `data-help="viz-py-run"` on the Explain visually / Trace again button; `data-help="viz-py-source"` on `<ol aria-label="Source code">`; `data-help="viz-py-stack"` on the Call stack panel; `data-help="viz-py-views"` on `<div role="tablist" aria-label="View">`.
- `<HelpTooltip id="call-stack" label="What is the call stack?" />` next to the "Call stack" heading, `<HelpTooltip id="trace-step" ... />` next to the step sentence, `<HelpTooltip id="series-vs-dataframe" ... />` and `<HelpTooltip id="array-shape" ... />` in the `DataGrid` footer line (shape, dtype), `<HelpTooltip id="missing-values-nan" ... />` next to "missing per column".
- Hook: `useHelpExample("python", "the Code Time Machine editor", { isDirty: () => code !== presets[0].code, load: (e) => setCode(e.code) })` in `CodeLab`, so a help example opens in the "Python code to trace" editor (the trace is cleared by the `key={code}` remount; the learner then presses Explain visually). Current visual examples use `target: "none"`; change them to `"python"` once this hook exists. Same hook for `/visual/data` (same `CodeLab`).

API (`components/visual/ApiStudio.tsx`): `data-help="viz-api-scenarios"` on `<div role="tablist" aria-label="Scenario">`; `data-help="viz-api-settings"` on the Client settings `<fieldset>`; `data-help="viz-api-frame"` on the `FrameDetail` status box; `data-help="viz-api-result"` on the Result `<p>`. Tooltips: `bearer-token` on the Credentials label, `retry-after` on Honour Retry-After, `exponential-backoff` on Backoff base (ms), `idempotency-key` on Send Idempotency-Key, `pagination` or `cursor-pagination` on Page size, `status-code-2xx-4xx-5xx` in the response status line. No editor, so no `useHelpExample` (examples stay `target: "none"`).

Charts (`components/visual/ChartExplorer.tsx`): `data-help="viz-chart-settings"` on the Chart settings `<fieldset>`; `data-help="viz-chart"` on the `aria-label="Chart"` box; `data-help="viz-chart-advice"` on `<ul aria-label="Chart advice">`; `data-help="viz-chart-data"` on the Data behind the chart `<details>`. Tooltips: `chart-dimension-vs-measure` on Dimension (group by), `aggregation` on Aggregation. No `useHelpExample`.

ETL (`components/visual/EtlPlayback.tsx`): `data-help="viz-etl-tabs"` on `<div role="tablist" aria-label="ETL topic">`; `data-help="viz-etl-stages"` on `<ol aria-label="Pipeline stages">`; `data-help="viz-etl-settings"` on the Pipeline settings `<fieldset>`; `data-help="viz-etl-frame"` on the frame status box; `data-help="viz-etl-result"` on the Run result `<p>`. Tooltips (ids owned by `data-engineering.ts`, already in the glossary): `watermark` on Watermark, `dead-letter-queue` on Dead-letter queue. Not duplicated in `visual.ts`. No `useHelpExample` (the ETL target kind belongs to the ETL builder, not this simulator).

Query Visualizer playback (`components/VizView.tsx`): the shared `PlaybackBar` replaces Back and Next; the `viz-playback` hook above covers it. Add `data-help="viz-compare"` on `QueryCompare`'s `<section aria-label="Compare queries">`. The `query-visualizer` help section (SQL author) owns its own tour; update its Back/Next wording on merge.

On merge also: remove `pending` from the seven visual sections, run `npx vite-node scripts/help-examples-verify.ts python-time-machine pandas numpy`, and re-check `e2e/help.spec.ts` tours.

### SQL

Content is `help/content/sql.ts` (sections `sql-practice`, `sql-playground`, `query-visualizer`). Nothing below is required for the tours to work: they use ids, roles, aria-labels and the existing `[data-help]` hooks (verified on a live dev server for `/questions/q01-product-revenue`, `/playground` and `/query-visualizer`). Not applied because the files are off limits:
- `pages/QuestionPage.tsx`: `data-help="question-description"` on the Description `Panel` div and `data-help="question-expected-output"` on the "Expected output" `<div className="mt-6">`; `<HelpTooltip id="expected-output" label="What is the expected output?" />` next to the "Expected output" heading; `data-help="question-tabs"` on `<div role="tablist" aria-label="Question sections">`; `data-help="question-visualize-tab"` on the Visualize query tab button; `<HelpTooltip id="difficulty-levels" label="What do the difficulty levels mean?" />` beside the `<Difficulty>` badge in the header; `<HelpTooltip id="query-visualizer-stages" label="What are the visualizer stages?" />` in the Visualize query empty-state text.
- `components/VizView.tsx`: `data-help="viz-tabs"` on `<div role="tablist">`, `data-help="viz-stages"` on `<ol aria-label="Stages">`; `<HelpTooltip id="provenance-badges" label="What do these labels mean?" />` beside the first `SourceBadge` in a stage card, and `<HelpTooltip id="explain-analyze" label="What does EXPLAIN ANALYZE do?" />` beside the Run EXPLAIN ANALYZE button.
- `components/PlanTree.tsx`: `data-help="viz-plan"` on `<ul aria-label="Query plan">`.
- `pages/QueryVisualizerPage.tsx`: `data-help="viz-presets"` on the preset button row, `data-help="viz-editor"` on the editor column, `data-help="viz-go"` on the Visualize button; the tour currently uses `main div.mb-3.flex.flex-wrap.gap-2` and `main button.inline-flex.bg-accent`. A `useHelpExample("sql", "the visualizer editor", ...)` hook is possible (`isDirty: () => sql !== PRESETS[0].sql`, `load: (e) => { setSql(e.code); setRan(null); }`); the visualizer example uses `target: "none"` until then.
- The Submit button lives in `src/components/SqlEditor.tsx` (not a `site/` file): the tour finds it with `#editor button[class*="border-accent/40"]`. A `data-help="sql-submit"` on it and `data-help="sql-run"` on Run All would be sturdier.
- The reset/clear tooltip id is `sql-reset-vs-clear` because `data-engineering.ts` already owns `reset-vs-clear`. Merge the two wordings if one id is preferred.

### Learning

Content is `help/content/learning.ts` (sections `daily-learning`, `projects-scenarios`, `mistake-notebook`, `analytics`). Applied already, in files that are allowed: `data-help` hooks and tooltips in `DailyDashboard`, `StudyTimePanel`, `StudyTimer`, `LearningAnalytics`, `ProjectCelebration`, `ProjectsPages`, `ScenarioPages`, `MistakeNotebookPage`, `PerformancePage`, `ProgressPage`. The lesson tour steps use existing selectors on `/daily/day/:n` (`ol[aria-label="Lesson steps"]`, `#lesson-top`, `.df-step`, `[aria-label="Completion requirements"]`, `[aria-label="Lesson study timer"]`; all verified on `/daily/day/1` except the Completion requirements list, which exists only on the Complete day step). Not applied because the files are off limits:
- `components/daily/LessonUi.tsx`: `data-help="lesson-exercise"` on the exercise `Card` of `GradedExercise` and `WrittenExercise`; `data-help="lesson-check-answer"` on the Check answer button; `data-help="lesson-hints"` on the Show a hint button; `data-help="lesson-knowledge-check"` on the `KnowledgeCheck` root `<div className="space-y-4">`; `data-help="lesson-complete"` on the Complete day `Card` (the one with `aria-label="Completion requirements"`); `<HelpTooltip id="knowledge-check" label="How is the knowledge check scored?" />` next to the "Knowledge check" heading in `DailyPages.tsx`; `<HelpTooltip id="completion-tracking" label="What makes a day complete?" />` next to "Complete this day"; `<HelpTooltip id="capstone-project" ... />` and `<HelpTooltip id="checkpoint-day" ... />` beside the `day.kind` badge (`Badge tone="secondary"`) in `DayHeader` and `DayRow` (glossary ids already exist).
- `pages/DailyPages.tsx`: `data-help="lesson-steps"` on `<ol aria-label="Lesson steps">`, `data-help="lesson-progress"` on the `ProgressBar` "Day activities done", `data-help="lesson-prereqs"` on the Prerequisites card, `data-help="lesson-theory-read"` on the `TheoryRead` root. The tour works without them through aria-labels.
- `/achievements` (`AchievementsPage.tsx`) has no help section of its own; it falls back to the platform guide. It is XP, missions and badges, not analytics, so `analytics` links to it instead of claiming the route.
- Glossary id `revision-queue` is owned by `library-career.ts`; `learning.ts` does not redefine it.
