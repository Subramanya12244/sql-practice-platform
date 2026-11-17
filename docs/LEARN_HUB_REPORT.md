# Learn hub: report

Branch `feature/learn-hub`, created from `origin/main` `0d5c358` (the merged UX redesign, PR #9). Released from the final commit `e466966` after the release checks described in the last section. The audit that came first is `docs/LEARN_HUB_AUDIT.md`. Screenshots are in `docs/images/learn-hub/`.

## What was built

`/learn` was a personal dashboard followed by the SQL course roadmap. It is now a learning hub, and the dashboard moved whole to `/dashboard`.

| Section on `/learn` | What it shows | Where the data comes from |
| --- | --- | --- |
| Hero | Learning-focused headline, topic search, a jump bar, and counts (270 lessons, 167 notes, 150 Python problems, 12 projects) | Curriculum and content counts |
| Continue learning | The most recent of: an unfinished Daily lesson, the next Daily lesson after a completed one, an SQL course lesson, or the last note, pattern or mind map opened. A new learner sees three starting points | `dailyResume`, `progress.lessons`, `progress.recent` |
| Recommended for you | Up to three suggestions, each quoting its reason (a lesson opened and not finished; a question attempted twice and not solved, with the topic that covers it; a note read whose questions are mostly unsolved; the next topic in a track already started). No activity gives none | `progress.questions`, `progress.read`, Daily record |
| Learning paths | SQL Developer, Python for Data, Data Analyst, Data Engineer: level range, lessons, planned hours, lessons completed, next lesson | Daily curriculum phases, note and lesson difficulty |
| Explore topics | Searchable library of 178 topics (167 notes plus 11 analytics modules), filters for subject, difficulty, topic and resource type, 12 per page, filter kept in the address | Notes, mind map links, Python exercises, Daily phases |
| Curriculum roadmap | The 270 Daily lessons as phases in three tabs (common core 90, analyst 90, engineer 90), with lessons, hours and completed counts | `curriculum.json` |
| Hands-on practice and projects | SQL and Python solved counts, scenarios, labs, three guided projects (in progress first, then easiest) | Questions index, `py:` progress, projects |
| Learning resources | Notes, patterns, mind maps, guides, cheat sheet, syntax reference, flashcards, study notes, with real counts | Content counts |

**New pages**

- `/learn/path/:id` (4 pages): objectives, prerequisites (with the common core's progress for the two branch paths), modules that open to their lessons, the free SQL course (SQL path), notes read per category, practical exercises with solved counts, the final project and its status, and a "recommended next lesson" card that states why.
- `/learn/topic/:slug` (178 pages): one topic with its note, concept guides, patterns, mind maps, "See it run" visual labs, SQL questions and Python problems with solved ticks, projects, interview questions (the note's own section plus any interview sets containing the topic's questions), read-first, leads-to and related topics, and the Daily phases that teach it.
- `/dashboard`: the previous `/learn` dashboard, unchanged apart from a link to the hub, and marked `noindex`.

**Routes.** Added: `/dashboard`, `/learn/path/:id`, `/learn/topic/:slug`. No route or content id was renamed or removed. `/learn` now shows the hub; the sidebar's Home > Dashboard points to `/dashboard`, and Learn > Learning hub points to `/learn`.

## Rules for what the hub shows

- Path progress is Daily lessons completed. Notes read, questions solved and Python problems passed are separate bars, never blended into a percentage.
- Study time is the lessons' own planned minutes; "left" is the same sum over lessons not completed.
- A topic is Not started, Read, or Learned (read and at least half its linked questions solved, the existing notes-page rule). Analytics modules are Not started, In progress or Completed from their Daily lessons. No topic is ever "mastered", and opening a page changes nothing.
- A path's Beginner to Advanced range is computed from a table of phase levels (`PHASE_LEVEL`, editorial, with a test that every phase has one) plus the SQL course's own lesson levels.
- Nothing new is stored. The hub reads the existing progress record and writes only the address bar (the library filter).

## Files changed

As of the last code commit `e466966`: 41 files, +3,511 / −109 lines against `origin/main` in six commits. Two docs-only commits (this report) follow it.

- **New, logic:** `lib/learnTopics.ts` (topics, filters, status, topic bundle), `lib/learnPaths.ts` (paths, roadmap, continue, recommendations), `lib/learnLoad.ts` (compact page data), `lib/noteStatus.ts` (the note rule, moved out of the page so both use one copy).
- **New, UI:** `components/learn/{LearnHero,PathCards,TopicLibrary,CurriculumRoadmap,PracticeResources,shared}.tsx`, `pages/LearnHubPages.tsx`.
- **Changed:** `routes.tsx`, `types.ts`, `lib/navigation.ts`, `components/SiteLayout.tsx` (footer links), `pages/LearnPages.tsx` (`LearnPage` became `DashboardPage`; lesson breadcrumb and structured data point to the SQL path), `pages/NotesPages.tsx` (imports the shared rule), Guide content (`library-career.ts`, `platform.ts`).
- **Tests:** `siteLearnTopics.test.ts`, `siteLearnPaths.test.ts`, `siteLearnHub.test.tsx`, `siteLearnTopicAudit.test.tsx` (every topic and path page), `e2e/learn-hub.spec.ts`, `e2e/learn-hub-release.spec.ts`; updated `siteNav.test.tsx`, `helpValidate.ts`, `e2e/ux-redesign.spec.ts`, `e2e/a11y-basics.spec.ts`.
- **Docs:** `LEARN_HUB_AUDIT.md`, this report, `images/learn-hub/` (10 screenshots).
- No change to Daily Learning content, execution engines, grading, auth, Supabase or sync code, `package.json`, the lockfile or workflows. No new dependencies.

## Guide (help) changes

The Guide's learn section had a tour of the old dashboard. It now tours the hub (7 steps) and the dashboard tour moved to a new "Learning dashboard" section for `/dashboard` (8 steps, minus the SQL-course step that moved). Two concept entries explain path progress and topic status. The help validator learned the two new route shapes.

## Tests run, and results

| Check | Result |
| --- | --- |
| `tsc -b` | Clean |
| `eslint src` | Clean |
| New unit tests (`siteLearnTopics` 26, `siteLearnPaths` 34, `siteLearnHub` 22, `siteLearnTopicAudit` 14) | 96 passed |
| Full Vitest (`TZ=UTC`) | 120 files, 6,942 passed, 10 skipped, 0 failed |
| `npm run build:site` (with the Supabase variables, as CI has them) | 1,138 pages prerendered, exit 0 |
| `npm run check:prerender` | No failed Suspense boundaries |
| `e2e/learn-hub.spec.ts`, dev server | Desktop 20 passed, 1 skipped; mobile 19 passed, 2 skipped; 0 failed |
| `e2e/learn-hub.spec.ts`, against the prerendered build | Desktop and mobile 39 passed, 3 skipped; 0 failed. No console errors or hydration warnings on `/learn`, two path pages, two topic pages, `/dashboard`, a note page and a lesson page |
| Related existing specs (`ux-redesign`, `a11y-basics`, `lesson-workspace`, `daily`, `smoke`, `help-tours`, `help`), desktop and mobile | 153 passed, 9 skipped, 0 failed |

The skipped e2e tests apply to one viewport only (keyboard and desktop-sidebar tests on phones, phone-layout tests on desktop).

What the browser checks cover: every path card opens its path; each path page shows its sections and the right next lesson; a module opens to its lessons and a lesson link opens the lesson; progress counts completed lessons only (an opened lesson does not move it); the continue card and recommendations come from a seeded progress record and each carries its reason; library search, subject, difficulty and resource-type filters combine, the empty state clears, Show more works, the address keeps the filter across a reload, the hero search jumps to the library; the library works from the keyboard; topic pages show real status (a note read with unsolved questions is Read, not Learned); roadmap tabs switch tracks; existing notes, patterns, mind maps, concepts, cheat sheet and flashcards stay reachable; no sideways scroll at 390 px on the hub, two paths, two topics and the dashboard.

## Build and page size

| | `origin/main` | This branch |
| --- | --- | --- |
| Pages prerendered | 955 | 1,138 (+178 topics, +4 paths, +1 dashboard) |
| `dist-site` | 182 MB | 193 MB |
| Largest script `site-*.js` | 2,912,556 B | 2,991,582 B (+79,026 B, +2.7%) |
| `/learn` HTML | 291,051 B | 242,500 B (the hub sends a compact topic list, not the note, pattern and map indexes) |
| Prerender time | 5.3 s | 5.6 s |

A topic page is 44 to 87 KB; the SQL path page is 215 KB; `/dashboard` is 257 KB (it carries the old dashboard's data). A test keeps the hub's embedded data under 120 KB and a topic's under 40 KB.

## Verification notes

- Browser checks at 1440 px and 390 px for the hub (new learner and with seeded progress), SQL and Data Engineer paths, and the left-join and excel topics. Screenshots are in `docs/images/learn-hub/`.
- A first run of the hydration check against `vite preview` showed React error 418 on every page with a sidebar, including pages this work does not touch. The cause was the preview server, which answers a path without a trailing slash with the home page's HTML. `origin/main` built locally shows the same, and production is clean. Serving `dist-site` the way Cloudflare does (a slashless path serves that page) gives no errors. That is what the "prerendered build" row above used.

## Known limitations and remaining issues

- **Browsers.** Firefox and WebKit were not run.
- **Live Supabase sync** is not verified (no staging project). The hub reads the same progress record the rest of the app uses and writes none of it, so sync behaviour is unchanged, but nothing here was tested against a live project.
- **Search results may shift.** `/learn` was indexed as "Learn SQL"; its title is now broader, and the SQL title and Course structured data moved to `/learn/path/sql-developer`. The dashboard at `/dashboard` is `noindex`. Anyone linking to `/learn` expecting the dashboard now lands on the hub. There is no Search Console access to check the effect.
- **Editorial pieces.** Path objectives and prerequisites are written text (taken from the phase summaries); phase and analytics-module levels are a table, covered by a test. The final project for the SQL path (`hr-analytics-warehouse`) is a judgment: it is the most SQL-centred of the 12.
- **The Daily SQL lessons are Days 31 to 60** and list the earlier days as prerequisites. The SQL path therefore starts a new learner on the free 18-lesson course (no prerequisites) and says why; the Daily lessons are the deeper pass.
- **A note with no linked questions becomes Learned once read** (the existing notes-page rule, now shown on topic cards). Python and data engineering topics mostly fall in this group, so Learned there means read.
- **Analytics has no notes.** Its 11 topics are Daily phases, so their pages list lessons and a visual lab but no theory note.
- **Topic cards show resource icons with counts** (practice, pattern, guide, map, project, visual, Daily). They carry text for screen readers and tooltips but are terse for sighted users.
- **The hub is long on a phone** (about 10,000 px with 12 topics showing). The jump bar, the paged library and collapsed modules keep it navigable, but it is a long page.
- **The error state is defensive.** If the hub data is missing, the page shows an error with a reload button; the site's own page loader normally handles a failed load first.
- **Not re-run:** the other Playwright suites (guided labs, visual engines, Query Cinema, tours of other sections) were not touched by this work and were not re-run. The profiler still has no Guide content (carried over from the redesign).
- **Draft files** `.venv-daily` (a symlink) and `docs/VISUAL_V2_AGENT_BRIEF.md` remain untracked and are not part of this work.

## Release checks (final commit `e466966`)

Run fresh on the exact commit that was pushed, against a static server that serves a slashless path the way Cloudflare does.

- `tsc -b` and `eslint src`: clean. Full Vitest: 120 files, 6,942 passed, 10 skipped, 0 failed. `build:site`: 1,138 pages. `check:prerender`: clean. Backend (104 passed) and the Python-block check (0 failures) ran on the previous commit; no backend or Python file changed since.
- A first full Vitest run under heavy machine load (another app held a CPU core, load average near 18) had 31 timeouts in `siteDaily`, `siteGuidedLabs`, `sitePyErrors` and `siteVisualEquivalencePython`, the tests that execute real Python and PostgreSQL. The same four files passed alone (5,117 passed, 0 failed), and a full run with 4 workers passed. No test was skipped or loosened.
- Browser: hub, release, redesign and accessibility specs, desktop and mobile, 110 passed, 10 skipped (viewport-specific), 0 failed. Existing regression specs (`ux-redesign`, `a11y-basics`, `lesson-workspace`, `daily`, `smoke`, `help`, `help-mobile`) 154 passed, 11 skipped, 0 failed on the tree that became `e466966`. `help-tours.spec.ts` reads the Guide registry from the Vite dev server, so it was run there and passed.
- The release spec loads 19 key routes and fails on any console error, hydration warning, failed request or HTTP 4xx/5xx, and checks titles, refresh, back/forward, breadcrumbs, that the dashboard kept every card, and that opening topics changes no progress.
- **A defect found by these checks and fixed before release:** on a phone, `/learn/topic/row-number` scrolled sideways (its long pattern titles widened an auto-sized grid column). Every grid in the hub now has a one-column base, and the release spec loads all 178 topic pages at 390 px and fails on any overflow.
- **Coverage the audit measured and did not hide:** of the 178 topics, 94 have no graded practice linked (mostly data engineering notes) and show an explicit empty state; 130 are not taught by any Daily phase; one (`power-bi`) has only its Daily lessons.
