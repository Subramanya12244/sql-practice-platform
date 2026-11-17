# DataForge UX redesign: Phase 0 audit

Date: 2026-11-16. Branch `feature/ux-redesign`, created from `origin/main` at `32b40f5` (PR #8, Query Cinema). Nothing has been changed in the application yet; this report comes first, as the brief requires.

## 1. Repository and git state

| Item | Finding |
| --- | --- |
| Worktree | `sql-practice-platform-integration`; other worktrees (`-evolution`, `-guide`, `sql-practice-platform`) hold stale copies; their work is already in `main` |
| Branch | `feature/ux-redesign` from `origin/main` `32b40f5`. Previous branch `feature/query-cinema-ux` is merged and untouched |
| Older UI branches | `ui-redesign`, `ui-motion`, `ui/dataforge-experience-overhaul`, `docs/phase0-product-audit`: all merged into `main` (0 commits ahead). Their work (card sections, motion system, Python IDE workspace, analytics) is the base this redesign builds on |
| Working tree | Clean, apart from two untracked files that are not part of this work (`.venv-daily`, `docs/VISUAL_V2_AGENT_BRIEF.md`). They stay untouched |
| Stack | React 18, react-router 6, Vite 6 static prerender (946 pages), Tailwind 3 with CSS-variable tokens, Monaco, PGlite (PostgreSQL WASM), Pyodide, `@xyflow/react`, recharts, mermaid, Supabase (optional sign-in and sync), Cloudflare Worker |
| Tests | 112 files in `src/test` (Vitest, `TZ=UTC`), 13 Playwright specs in `e2e/` (desktop and mobile Chromium), Python verification in `scripts/daily-browser-verify.mjs` |

## 2. What already exists (so it is improved, not duplicated)

The platform is not a blank template. A design system, a motion system and a UI kit are already in place.

**Tokens** (`tailwind.config.js`, `src/site/site.css`): RGB-channel CSS variables for surface (4 levels), border, accent (teal), secondary (violet), success, warn, danger, ink (3 levels), hover, on-accent. Full light and dark sets, chart tokens, three shadows, radii `card` 14px and `control` 10px, Inter and JetBrains Mono, one easing family and three speeds (140, 220, 420 ms), keyframes for fade, slide, scale, shimmer, float. A global `prefers-reduced-motion` rule clamps durations. A `:focus-visible` ring is global. `.cinema-dark` is a scoped dark theme.

**UI kit** (`components/ui.tsx`, 308 lines): `Container`, `PageHeader`, `Button`/`ButtonLink` (variants, sizes), `Card`, `Badge`, `Chip`, `ProgressBar`, `ProgressRing`, `SegmentedProgress`, `StatCard`, `SectionHeader`, `EmptyState`, `ErrorState`, `Skeleton`, `Tabs`, `Tooltip`, `Toolbar`, `IconButton`, `RadioCard`, `SwitchRow`.

**Shell** (`SiteLayout.tsx`, `AppSidebar.tsx`, `lib/navigation.ts`): sticky header, collapsible desktop sidebar (preference remembered, group disclosure, active indicator), mobile accordion menu, theme toggle, account menu, notification bell, global search (`SearchDialog`, opened with Ctrl/Cmd+K or `/`), skip link, soft page transition (skipped under reduced motion), Guide help button. Breadcrumbs exist on about 10 pages (`seo.tsx` supplies the JSON-LD), but there is no shared visual breadcrumb component.

**Pages**: 89 routes (section 4). Home, Learning dashboard (`/learn`), Daily Learning dashboard and lesson workspace, SQL and Python practice, playground, labs, projects, career pages, visual tools (including the new Query Cinema).

## 3. Current look, from screenshots (17 routes, desktop 1440 and mobile 390, logged out)

- No console errors and no page errors on any of the 17 routes.
- Horizontal overflow: only `/schema-designer` on mobile (212 px). All others fit.
- Home: a text-heavy hero ("Learn SQL and data engineering by building") with four feature cards and three counters. It lists SQL and Python only; analytics, data engineering and BI are not presented as learning domains. There is no data-flow visual. Two secondary buttons wrap awkwardly. The "Continue" section is present, further down.
- Dashboard (`/learn`): clear and consistent (hub card, four stat cards, challenges). Skill mastery, revision and project activity are on other pages (`/progress`, `/analytics`, `/mistakes`, `/readiness`) rather than one workspace.
- Daily Learning: a good programme dashboard and a seven-step lesson (Understand, Learn by example, Guided practice, Independent practice, Knowledge check, Daily review, Complete). The lesson is a single column: no left day navigation, no right-hand contents or key concepts, no reading progress.
- Labs: the ETL builder is functional, but its canvas is small and the nodes are tiny at 1440 px. The header and toolbar take about 40 percent of the first screen.
- Navigation: eight groups (Dashboard, Daily Learning, Learn, Practice, Projects, Intelligence, Career, Community) with about 55 items. The brief asks for six.

## 4. Feature inventory: every route and its purpose

**Home and account**: `/` landing and continue-learning; `/login`, `/signup`, `/reset-password`, `/account` (profile, reviews, security), `/settings`, `/profile` (public profile), `/admin` (admin only), `/debug` (diagnostics), `*` (not found).

**Dashboard family**: `/learn` learning dashboard and the 18-lesson SQL course; `/learn/:slug` lessons; `/progress`; `/analytics` (solve time, topic strength, activity); `/mistakes` (Mistake Notebook); `/achievements` (XP, missions); `/history` (submissions and revision); `/review` (spaced revision queue); `/readiness` (interview readiness, evidence-based).

**Daily Learning**: `/daily` programme dashboard; `/daily/day/:n` and `/daily/:path/day/:n` lessons. 270 authored lessons (90 common, 90 analyst, 90 engineer; a learner follows 180 days).

**Learn content**: `/notes`, `/notes/:slug` (65 SQL topics); `/study-notes` (PDF notes); `/data-engineering` (tracks); `/patterns`, `/concepts`, `/mindmaps`, `/shortcuts`, `/cheatsheet`, `/flashcards`.

**Practice**: `/questions`, `/questions/:slug`, `/questions/custom`, `/topics/:slug` (150 SQL questions); `/practice/python`, `/practice/python/:slug` (150 Python problems); `/practice/python/assessment`; `/assessments`; `/scenarios`, `/scenarios/:slug`; `/interview`, `/interview/:slug`; `/mock-interview`; `/playground` (six practice databases); `/schema` (Northwind schema); `/challenge`, `/leaderboard`; `/debug-lab`.

**Labs and data engineering**: `/etl-builder`, `/dag-simulator`, `/schema-designer`, `/dq-exercises`, `/de-scenarios`, `/data-quality` (data quality lab), `/data-generator`.

**Visual tools**: `/visual` hub and `/visual/{python,data,api,etl,charts,tree,graph,excel,linux,git,stats,business,interview}`; `/query-visualizer` (Query Cinema); `/solution-comparison`; `/ai-tutor` (rule-based "Query helper", no paid AI).

**Projects and career**: `/projects-lab`, `/projects-lab/:slug` (12 guided projects); `/career`, `/career/planner`, `/career/companies(/:id)`, `/career/answers`; `/portfolio`, `/portfolio/export`.

Gaps against the brief (named so they are not invented):
- There is **no capstone page**; capstone-style content lives in the guided projects and the Daily curriculum. The navigation will link to what exists.
- There is **no resume builder page**; `lib/resume.ts` and `ResumeProjects.tsx` supply resume project text on the Portfolio page. It will be labelled for what it is.
- A **Data Quality Observatory** (CSV upload and profiling) is partly covered by `/data-quality` and `lib/dataQuality.ts`; a **Database Explorer** by `/schema` and `/playground`. Phase 7 will extend these rather than create parallel pages.

## 5. Navigation: current groups mapped to the six requested categories

Every existing destination keeps a menu entry. New group, then what moves into it:

| New group | Contents (existing routes) |
| --- | --- |
| Home | `/` Home; `/learn` Dashboard; `/progress`; `/analytics`; `/mistakes`; `/achievements` |
| Learn | `/daily` Daily Learning (and Day 1); `/data-engineering` tracks; `/learn` SQL course; `/notes`; `/study-notes`; `/mindmaps`; `/patterns`; `/concepts`; `/shortcuts`; `/flashcards`; Revision (`/review`, `/history`) |
| Practice | `/questions`; `/practice/python`; `/scenarios`; `/assessments`; `/practice/python/assessment`; `/interview`; `/query-visualizer`; `/playground`; `/solution-comparison`; `/ai-tutor`; `/challenge`; `/leaderboard` |
| Labs | `/etl-builder`; `/dag-simulator`; `/schema-designer`; `/dq-exercises`; `/de-scenarios`; `/data-quality`; `/debug-lab`; `/visual` (watch code, data, APIs run); `/data-generator`; `/schema` |
| Projects | `/projects-lab`; `/portfolio`; `/portfolio/export` |
| Career | `/career/planner`; `/career/companies`; `/career/answers`; `/mock-interview`; `/readiness`; `/portfolio` |

Dependents to update with the change: `lib/navigation.ts`, `AppSidebar.tsx` (icon map by group id), `SiteLayout.tsx` (mobile menu, footer), `siteNav.test.tsx`, `siteNavSsr.test.tsx`, `siteSanityAudit.test.ts`, `e2e/smoke.spec.ts` (clicks the "Dashboard" group), Guide content and tours that name menu groups (`help/content/platform.ts`, `help/Onboarding.tsx`).

## 6. Daily Learning

- Content is data: `content/daily/curriculum.json`, `days/*.md|json`. Not modified by this redesign.
- Status is real: `lib/daily.ts`, `dailyProgress.ts`, `useDaily.ts`, `dailyStudy*.ts`. Every one of the 270 lessons was validated earlier; the UI will keep showing real availability and completion only.
- Components: `DailyDashboard.tsx`, `LessonUi.tsx`, `StudyTimer.tsx`, `StudyTimePanel.tsx`; pages in `DailyPages.tsx` (317 lines).
- Completion (lesson) and mastery (exercise evidence) are separate today and stay separate.

## 7. Execution environments and persistence (must not break)

- SQL: PGlite worker (`pglite.worker.ts`, `sqlRunner.ts`, `browserDb.ts`); every run is rolled back; grading compares to a reference query on Northwind and hidden extra rows.
- Python: Pyodide worker (`pyodide.worker.ts`, `pyRunner.ts`); `pyExercises`, `pyPractice`, `pyAssessment`.
- Progress: local storage (`progress.ts`) with optional Supabase sync (`dataSync.ts`, `auth.tsx`, migrations `dataforge_010`-`012` applied by the owner). Live sync is **unverified** against a real Supabase; nothing in this redesign changes that, and it will not be claimed as tested.
- Tests that guard these: `siteSupabaseSyncApp`, `supabaseRls`, `siteDaily*`, `siteVisual*`, `siteQueryCinema*`, `siteHelp*`, grading and Pyodide equivalence suites.

## 8. Findings that drive the work

1. A design system exists. The redesign will refine tokens and add missing primitives (breadcrumb, page shell with side panels, reading progress, code-block with copy), not replace them.
2. The homepage under-represents the product (no analytics, data engineering or BI domains, no learner journey, no data-flow visual).
3. Navigation has eight groups and about 55 items, against a target of six categories.
4. The dashboard answers progress questions across several pages; a single workspace with mastery, revision and project sections is missing. Skill mastery by topic exists in `lib/readiness.ts`, `lib/learningInsights.ts` and the practice evidence; no "Started / Practicing / Completed / Mastered" view exists yet, and Pandas, Statistics, Airflow, Spark and similar skills have **no exercise evidence source** today. They will be shown as "Not assessed" instead of being invented.
5. The Daily lesson is a single column; the three-pane workspace, reading progress and resume position are missing.
6. Lab canvases (ETL, DAG, schema) work but are cramped; `/schema-designer` overflows on mobile.
7. Breadcrumbs are inconsistent; no shared component.

## 9. Plan and order

Each phase: inspect, change, run focused tests plus `tsc -b` and ESLint, check desktop and mobile in a browser, record the result here, then continue. Local commits per phase on `feature/ux-redesign`; no push, merge or deploy.

| # | Phase | Main files |
| --- | --- | --- |
| 1 | Design system: token refinement (type scale, spacing, state tokens), shared `Breadcrumbs`, `CodeBlock` with copy, `PageShell` with side panels | `site.css`, `tailwind.config.js`, `components/ui.tsx` |
| 2 | Homepage: hero with a data-flow visual, four learning domains, LEARN-PRACTICE-BUILD-PROVE-GROW journey, featured tools, real continue-learning | `pages/HomePage.tsx` |
| 3 | Navigation: six categories, breadcrumbs, tooltips, Ctrl/Cmd+K scope check | `lib/navigation.ts`, `AppSidebar.tsx`, `SiteLayout.tsx`, nav tests, Guide text |
| 4 | Dashboard workspace: overview, continue, next actions, skill evidence, revision, projects | `pages/LearnPages.tsx`, `lib/dashboard.ts` |
| 5 | Daily Learning: 180-day journey view, three-pane lesson workspace, reading progress, resume position | `pages/DailyPages.tsx`, `components/daily/*` |
| 6 | Tools: Query Visualizer polish, Python Playground layout, ETL, DAG, Schema (mobile overflow), DQ, DE scenarios | pages and `components/lab/*` |
| 7 | New features only if time and stability allow, extending existing pages | `/data-quality`, `/schema`, error coach, portfolio |
| 8 | Accessibility, performance, full verification, report | all |

Constraints kept: no routes or content IDs renamed, no new dependencies, no paid APIs, no changes to curriculum content, execution engines, grading or sync code.

## 10. Phase log

Local commits on `feature/ux-redesign` (never pushed). Each phase: focused tests, `tsc -b`, ESLint, then a browser check at desktop and mobile widths.

| Phase | Commit | Result |
| --- | --- | --- |
| 0 Audit | `e5a1b6d` | This report |
| 1 Design system | `e5a1b6d` | `info` state colour; type scale (`text-display`, `text-h1`, `text-h2`, `text-h3`, `text-lead`, `text-label`); shared `Breadcrumbs`; `info` Badge tone; `PageHeader` and `SectionHeader` use the scale. Existing tokens, motion and focus rules kept |
| 2 Homepage | `e5a1b6d` | New hero ("Become a Data Professional.", Start Learning, Explore Curriculum) with a data-pipeline visual whose rows link to real practice pages; four learning domains; the Learn-Practise-Build-Prove-Grow journey; six featured tools; Daily Learning resume card from real progress. Removed the marketing-only sections (feature highlights, Python stage grid, popular questions); every one of those destinations is still reachable. Fixed: completed projects was hard-coded to 0 |
| 3 Navigation | `a62ab40` | Six categories (Home, Learn, Practice, Labs, Projects, Career); no path in two groups; header breadcrumb trail; item descriptions as tooltips; Ctrl/Cmd+K now also finds tools and pages, Daily lessons and Python exercises, and ranks a whole-phrase title match first. Footer and Guide text follow |
| 4 Dashboard | `7ebd1f5` | "What to do next", "Revision and mistakes", "Skill mastery" (ten skills, five evidence-based statuses), "Projects", and the Daily resume card. Pure models in `lib/skills.ts`, `lib/dashboardModel.ts`. Fixed: the Daily dashboard's Mastered count was always 0 |
| 5 Daily Learning | `29f4711`, `7784b28` | Lesson workspace: phase day list, lesson, rail (time, progress, key concepts, prerequisites, section headings); reading progress; remembered step and scroll with an explicit Resume; footer with previous, finish, next. Exercises: plain-language error explanations, expected-versus-yours with the first differing line. Fixed: page jump on laptop widths |
| 6 Tools | `f2dadfb` | Query visualizer Format SQL; larger ETL and DAG nodes and canvases; schema designer no longer scrolls sideways on phones (a site-wide `fieldset` fix) |

