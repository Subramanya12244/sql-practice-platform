# DataForge UX redesign: final report

Branch `feature/ux-redesign`, 10 local commits on `origin/main` `32b40f5`. **Nothing is pushed, merged or deployed.** Release waits for your approval. The audit that came first is `docs/UX_REDESIGN_AUDIT.md`.

## 1. Initial audit findings

DataForge already had a design system, a UI kit, a motion system and a working shell, so this was an upgrade of the existing app, not a rewrite. What was missing:

- The homepage showed SQL and Python only, with no learner journey and no data-flow visual.
- Navigation had eight groups and about 55 items; the brief asks for six categories.
- Progress questions were answered on several pages; there was no single workspace with skill status, revision and projects.
- The Daily lesson was one column with no day list, rail, reading progress or resume.
- Two real defects: the Daily dashboard's Mastered count was always 0, and the homepage's completed-projects count was hard-coded to 0.
- `/schema-designer` scrolled sideways on phones.

## 2. Design system changes

- New `info` state colour (light, dark, cinema) and an `info` Badge tone.
- A type scale in `tailwind.config.js`: `text-display`, `text-h1`, `text-h2`, `text-h3`, `text-lead`, `text-label`. `PageHeader` and `SectionHeader` use it.
- Shared `Breadcrumbs` component. `Card` accepts `data-help` so Guide tours can target it.
- Kept: the existing tokens, three-speed motion, global reduced-motion rule and focus ring.

## 3. Pages redesigned

| Page | Change |
| --- | --- |
| Home | "Become a Data Professional." hero with Start Learning and Explore Curriculum; a pipeline visual whose five rows link to real practice pages; four learning domains with tracks; Learn, Practise, Build, Prove, Grow; six featured tools; a Daily resume card from real progress. Counts shown are real (270 lessons, 150 SQL, 150 Python, 12 projects) |
| Navigation | Six categories: Home, Learn, Practice, Labs, Projects, Career. Every page keeps one entry; none appears in two groups. Header trail (group, section); descriptions as tooltips; footer regrouped |
| Search (Ctrl/Cmd+K) | Also finds tools and pages, Daily lessons and Python exercises; a whole-phrase title match ranks first ("day 12" no longer opens Day 112) |
| Dashboard `/learn` | "What to do next", "Revision and mistakes", "Skill mastery" (10 skills), "Projects", plus the Daily resume card. Each next action states the fact it comes from |
| Daily lesson | Day list for the phase, the lesson, and a rail (time, progress, key concepts, prerequisites, headings of the current step). Reading progress bar; remembered step and scroll with an explicit "Resume where you left off"; footer with previous, finish and next. One column with folded blocks below 1280 px; three panes from 1536 px |

## 4. Existing features improved

- Daily exercises: plain-language error explanations (Python hints, SQL fixes) and an expected-versus-yours view with the first differing line.
- Query visualizer: Format SQL button.
- ETL and DAG canvases: larger node text, taller canvases, tighter fit.
- Schema designer: no sideways scroll on phones (a site-wide `fieldset { min-width: 0 }`).
- Logo: unique SVG gradient ids (the same id was repeated three times per page).
- Guide: tour steps and text updated for the new navigation, dashboard and example chips.

## 5. New features

- **Data profiler** (`/data-profiler`, under Labs): profile your own CSV in the browser. Column types, missing values, duplicate rows, values that do not fit, mixed formats, outliers, histograms, possible keys, and a Markdown report. Never uploaded. Includes a sample labelled "not your data". 15 unit tests, e2e with a real file upload.

### Brief items not built, and why

| Item | Status |
| --- | --- |
| Database Explorer | Not built as a new page. `/schema` (ER diagram, columns, keys) and `/playground` already cover table browsing, sample data and SQL |
| Intelligent Error Coach | Existing rule-based pieces (`errorHelp`, `pyErrors`, hint ladder, result diagnosis) were extended in Daily exercises. No new standalone coach |
| Portfolio Builder, Interview Simulator | Not changed. `/portfolio`, `/portfolio/export`, `/mock-interview` and the readiness page already exist |
| Python Playground restyle | Not changed beyond what the new type scale and tokens give it |
| Drag-and-drop ETL, DAG backfill view, schema relationship editing | Not changed; the existing editors already support what they support. Only legibility and size were improved |
| Capstones page, resume builder page | Do not exist in the product. The navigation links only to pages that exist; guided projects stand in for capstones |
| Skill mastery for "Pandas, Statistics, Airflow, Spark" from exercises | These skills have no graded-exercise source today, so their status comes only from Daily lessons. A skill with no evidence reads "Not assessed" |

## 6. Files changed

50 files, +2,724 / −312 lines against `origin/main`.

- New (app): `components/home/{HeroPipeline,HomeSections}.tsx`, `components/dashboard/DashboardPanels.tsx`, `components/daily/LessonWorkspace.tsx`, `lib/{skills,dashboardModel,dailyResume,csvProfile}.ts`, `pages/DataProfilerPage.tsx`.
- Changed (app): `tailwind.config.js`, `site.css`, `components/{ui,SiteLayout,AppSidebar,SearchDialog}.tsx`, `components/daily/{DailyDashboard,LessonUi}.tsx`, `components/lab/*Workspace.tsx` (3), `components/BrandMark.tsx`, `lib/{navigation,searchIndex,daily,useDaily}.ts`, `pages/{HomePage,LearnPages,DailyPages,QueryVisualizerPage}.tsx`, `routes.tsx`, Guide content (4 files).
- New tests: unit `siteUxHome`, `siteSearchScope`, `siteDashboardModel`, `siteLessonWorkspace`, `siteExerciseFeedback`, `siteFormatSql`, `siteCsvProfile`; e2e `ux-redesign`, `lesson-workspace`, `a11y-basics`. Updated: `siteNav`, `siteSanityAudit`, `e2e/smoke`, `e2e/daily`.
- Docs: `UX_REDESIGN_AUDIT.md`, this report.
- No changes to curriculum content, execution engines, grading, auth or sync code. No routes or content ids renamed (one route added). No new dependencies.

## 7. Tests executed

| Check | Result |
| --- | --- |
| Full Vitest (`TZ=UTC`) before the profiler | 115 files, 6,830 passed, 10 skipped, 0 failed (two real-CPython timeouts seen once under machine load passed in this run) |
| Full Vitest after the profiler (final) | 116 files, 6,845 passed, 10 skipped, 0 failed |
| `tsc -b`, ESLint (`src`) | Clean |
| Production build (`build:site`) | 954 pages prerendered, exit 0 |
| `check:prerender` | "no failed Suspense boundaries" |
| Existing browser suites (smoke, guided labs, visual, visual engines, help, help mobile, daily study, Query Cinema, tours), desktop and mobile | 182 passed, 4 skipped, 0 failed |
| New and changed browser specs (redesign, lesson workspace, accessibility, Daily, help tours), desktop and mobile, 1 retry allowed | 71 passed, 9 skipped (tests that apply to one viewport only, and the tour spec on phones), 0 failed |
| Accessibility structure, 16 pages | Every button and link named, every field labelled, one h1, one main landmark, no duplicate ids, alt text; skip link and focus ring |

Not run: Firefox and WebKit for any of this work; live Supabase sync (no staging project exists, so **it has not been verified**); production checks (nothing is deployed).

## 8. Desktop and mobile verification

- Browser checks at 1680, 1440, 1366 and 390 px for home, dashboard, lesson, profiler, navigation and search; light theme checked for home and the lesson.
- All 17 audited routes: no sideways scroll and no console errors at 1440 and 390 px (after the schema designer fix).
- Bugs the new tests found in my own work, now fixed: the lesson page jumped down 1,750 px on laptop widths (`scrollIntoView` in the day list); the reading-progress bar was hidden from assistive technology; the logo's duplicate ids.

## 9. Performance observations

- The prerender took 5 s for 954 pages. The largest script, `site-*.js`, is 2.8 MB uncompressed; I did not compare it with `main` and cannot say how much of it is new. The new code is small (the home and dashboard panels, the lesson workspace and the profiler); the search index loads lazily, and the formatter loads on first use.
- Reading progress uses one passive scroll listener and `requestAnimationFrame`; resume writes are debounced to one per 800 ms.
- No animation was added that runs under reduced motion; the pipeline line is stopped by the existing global rule.

## 10. Remaining issues

- The lesson footer's "Finish the day" only moves to the completion step; completing a day still needs the real work, as before.
- The header breadcrumb shows only from 768 px up; on phones the page title and menu carry that job.
- The dashboard's hero ("Start the first lesson", the SQL course) and the Daily "Start Day 1" card are two different starts for a new learner. Both are accurate, but they could be merged in a later pass.
- ETL and DAG canvases with many nodes still shrink to fit; there is no wrapped layout.
- The Daily lesson's step tabs scroll sideways inside their row at about 1280 px.
- A search for a very common word lists many exercises after the tools and lessons.
- Guide (Help) content for `/data-profiler` was not written; the page is self-explanatory but has no tour.
- The profiler reads ISO dates only; day-first and month-first dates are reported as mixed formats, not parsed.
- A first-visit Welcome card from the Guide can sit over the page until dismissed.
- Machine slowness caused a few one-off test timeouts during development; each passed on re-run, and none was a code defect.

## 11. Git status

- Branch `feature/ux-redesign`, 10 commits ahead of `origin/main` (`32b40f5`), working tree clean except two untracked files that are not part of this work (`.venv-daily`, `docs/VISUAL_V2_AGENT_BRIEF.md`).
- Not pushed, not merged, not deployed. The earlier branches and worktrees are untouched.
- To release, you would approve a push, a PR and a merge; a merge to `main` deploys automatically.
