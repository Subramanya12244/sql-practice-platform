# Learn hub: audit before implementation

Branch `feature/learn-hub`, created from `origin/main` `0d5c358` (the merged UX redesign, PR #9). Nothing here is pushed, merged or deployed.

## What `/learn` is today

- One page, `LearnPage` in `pages/LearnPages.tsx`. It is a personal dashboard (hero with continue button, daily goal, next actions, streak and XP, week chart, revision, skill mastery, bookmarks, achievements, missions, concept progress, study modules) followed by the 18-lesson SQL course roadmap.
- The lessons themselves are `/learn/:slug` (18 lessons, 61 graded exercises, levels Beginner 6, Intermediate 9, Advanced 3).
- Pages that link to `/learn`: the sidebar (Home > Dashboard), the footer, the Guide (`learn-library` section and its tour, six `data-help` hooks), the lesson page breadcrumb, and three e2e specs.
- The page has no learning paths, no topic search, and no single place that joins a topic's note, practice and projects.

## Data that already exists (and will be reused, not copied)

| Source | What it holds | Used for |
| --- | --- | --- |
| `content/daily/curriculum.json` (`lib/daily.ts`) | 270 authored lessons in 29 phases; common core 90 days, analyst 90, engineer 90; planned minutes per lesson; phase to note, project and mind map links | The structured curriculum roadmap, every path's lessons, study time and "next lesson" |
| Notes, 167 (`lib/learning.ts`) | category, difficulty, minutes, prerequisites, related notes, linked SQL questions, patterns, guides and projects; every note has an "Interview questions" section | The topic library (one topic per note) and every topic page |
| `content/tracks.json` (`lib/tracks.ts`) | Python plus six data engineering tracks, with mind maps and projects | Subjects and categories |
| Python exercises, 150 | each has `topic` equal to a note slug (150 of 150 match) | Exercises on a topic page |
| Patterns 22, concept guides 33, mind maps 17 (map nodes link to notes) | | Related resources |
| Projects, 12 (`lib/projects.ts`) | level, minutes, status derived from real task progress | Final project of each path |
| Progress (`lib/progress.ts`, `lib/dailyProgress.ts`) | notes read, questions solved, Python passed (`py:<slug>`), lesson exercises, bookmarks, recent pages, Daily days | All progress shown. No new progress store |
| `noteStatus` (New, Read, Learned) in `NotesPages.tsx` | Learned means read and at least half the linked questions solved | Topic status. A topic is never "mastered" because it was opened |
| `lib/skills.ts`, `lib/dailyResume.ts`, `lib/dashboardModel.ts` | skill status rules, the lesson a learner should resume | Continue card and recommendations |
| `components/ui.tsx`, `components/LearnUi.tsx` | Card, Badge, ProgressBar, SegmentedProgress, Tabs, EmptyState, ErrorState, Skeleton, LevelBadge, BookmarkButton | All new UI |

Gaps found: there is no Data Analytics note category (analytics is only taught in Daily Learning phases such as Excel, EDA, Power BI), no per-path objectives, and no topic page. Python's and SQL's visual labs exist but no table says which note they explain.

## Decisions

1. **`/learn` becomes the hub. The existing dashboard moves, unchanged, to a new route `/dashboard`.** The brief says `/learn` must stop being "another dashboard", and also says to preserve functionality. Moving the component whole keeps every dashboard feature, its Guide hooks and its tests. The sidebar's Home > Dashboard points to `/dashboard`; the hub is the first item under Learn. Old links to `/learn` still work and land on the hub, which carries the learner's continue card.
2. **New routes:** `/learn/path/:id` (four paths) and `/learn/topic/:slug` (one per note plus analytics modules). `/learn/:slug` (lessons) is untouched; two-segment paths cannot match it.
3. **Topics = the 167 notes, plus 11 analytics modules** taken from Daily phases that have no notes (Excel, EDA, Power BI and so on). Without those the "Data Analytics" subject would be empty. Subject comes from the note category (SQL categories to SQL, `python` to Python, the other tracks to Data Engineering).
4. **Each path's lessons are its Daily Learning phases.** Progress is lessons completed from the learner's own Daily record. Notes read, questions solved and exercises passed are shown as separate bars. They are never blended into one invented percentage.
5. **Study time is planned minutes** from the lessons' own `minutes` field; remaining time is the same sum over lessons not yet completed.
6. **Level range of a path** is computed from the difficulty of its notes and lessons. Nothing is typed in by hand except the analytics module levels, which are a small documented table with a test that covers every module.
7. **Recommendations carry a reason that quotes the evidence** (a lesson in progress, a missed question, a note read with its questions unsolved, a started track). With no activity there are no recommendations, only a start prompt.
8. **Page data stays small.** The hub and topic loaders send a compact projection (title, subject, level, counts and slugs) instead of the full note, pattern and map indexes, so the 178 new prerendered pages do not each carry hundreds of KB.
9. **Not touched:** Daily Learning content, routes, content ids, progress storage and sync, auth, dependencies.

## Risks

- The sidebar's Home > Dashboard entry and the Guide's learn tour point at `/learn` today; both move with the dashboard (`/dashboard`) and the Guide gets a hub section.
- `/learn` is currently indexed as "Learn SQL". The Course structured data and the SQL title move to the SQL path page; the hub's title covers all four subjects.
- About 180 more prerendered pages; build time and `dist-site` size are measured and reported.
