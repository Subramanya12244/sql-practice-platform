# Learning platform: gap analysis and plan

This document checks the "Master Enhancement Specification" against the code as of 2026-11-04.
- **Public site:** `frontend/src/site/`, static, PGlite in the browser, optional Supabase.
- **Local app:** `frontend/src/` with FastAPI in `backend/`, plus the `northwind` and `sql_practice` databases.

Content formats are defined in [CONTENT_SPEC.md](CONTENT_SPEC.md).

## Gap analysis

| Spec module | Status before this round | Where it lives / what changed |
|---|---|---|
| A. Learning dashboard `/learn` | Partial: lesson roadmap only | **Done (Phase 1).** `/learn` now holds: module links, the daily goal, the revision queue, "recommended next" (an unread note whose prerequisites are read), recently viewed, bookmarks, concept progress by category, and weak-spot practice. The lesson roadmap is kept. |
| B. Theory notes `/notes` | Partial: 33 SEO concept guides (`/concepts`) and 18 lessons, neither in the 17-section format | **Done (Phase 1).** 65 notes in 8 categories, following the spec's section structure. They carry prerequisites and related links to notes, patterns, guides, mind maps and questions. There is a table of contents, mark-as-read and bookmarks. Concept guides stay as SEO articles, and notes link to them through `guides:`. |
| C. Shortcuts `/shortcuts` | Partial: one static cheat sheet | **Done (Phase 1).** 13 searchable categories, with copy and "run in playground" buttons. Adds `/shortcuts/comparisons` (10 comparisons) and `/shortcuts/interview-revision`. The cheat sheet is kept. |
| D. Mind maps `/mindmaps` | Missing; only the schema ER diagram existed | **Done (Phase 1).** 10 interactive maps (React Flow) with expand/collapse, zoom and pan, and node search. Clicking a node opens its notes, pattern, prerequisites and questions. Nodes are coloured as learned or weak, and maps export to PNG and SVG. A crawlable text outline is included. |
| E. Patterns `/patterns` | Partial: some guides (duplicates, nth-highest, top-N, running total, gaps and islands, YoY) | **Done (Phase 1).** 22 patterns, each with problem, when to use it, solution, alternatives, walkthrough, mistakes and performance. Overlapping guides are linked, not copied. |
| F. Flashcards / revision | Partial: `/flashcards` (Leitner, 133 cards) and `/review` (spaced re-solving of questions) | Phase 2: unify them under `/revision`, add personal cards made from notes and mistakes, and concept filters. |
| G. Mistake intelligence | Partial: in the local app (`/mistakes`, ChatGPT-imported mistakes); the public site has a per-question "mistakes I made" section and an error coach | Phase 2: structured mistake log on the public site (deterministic error class from the coach vs inferred), repeat detection, recommendations. |
| H. Adaptive learning | Partial: `lib/insights.ts` weak-topic scoring and "Practice next" | Phase 2: proficiency per concept across knowledge, application, accuracy, hints, time and retention. Repo, practice, assisted and mastered results are recorded separately. |
| I. Mock interview | Partial: `/mock-interview` (5 questions, timer, history); `/interview` holds the role-based sets | Phase 3: 15, 30 and 45-minute and topic, role or previous-mistake modes; per-question time and hint tracking; a report. `/interview` stays as the sets hub and links to the mock interview. |
| J. SQL optimisation lab | Partial: "Explain plan" tree in the editor (EXPLAIN JSON in PGlite) | Phase 4: `/sql-lab` with EXPLAIN ANALYZE, index demos and rewrite exercises. It runs in PGlite, which is isolated per browser tab. |
| K. Analytics | Partial: `/progress` and the local `/dashboard` | Phase 3: `/analytics` with accuracy, solving time, provenance split, revision completion, and weekly or monthly charts. |
| 4. Connect learning ↔ practice | Partial | **Done for Phase 1 content.** Every note and pattern lists its questions, and each question page lists the notes and patterns that teach it ("Learn the concepts"). Mind map nodes link to notes, patterns and questions. Shortcuts link to notes. Site search (⌘K) covers all of these. |
| 5. ChatGPT history replay | Local app imports conversations | Phase 3: a per-question replay view in the local app. Imported facts are kept distinct from suggested material. |
| 9. UI/UX | Partial | Done this round: regrouped navigation with a "More" menu, ⌘K search, breadcrumbs, bookmarks, copy-code buttons, SQL highlighting, and a split workspace on question pages. |

## Phase 1: shipped
- **Content.**
  - `content/notes/<category>/*.md` (65), `content/patterns/*.md` (22), `content/shortcuts/*.json` (13 categories) plus 2 pages, and `content/mindmaps/*.json` (10).
  - Every reference is checked, and every runnable SQL block runs on the browser database, in `src/test/siteContent.test.ts`.
- **Code.**
  - Loaders: `lib/learning.ts`.
  - Pages: `pages/{NotesPages,PatternsPages,ShortcutsPages,MindMapPages}.tsx`.
  - Components: `components/{MindMapCanvas,LearnUi,SearchDialog}.tsx`.
  - Search index: `lib/searchIndex.ts`.
  - Code-block actions: `components/Markdown.tsx`.
  - Progress fields: `bookmarks`, `recent`, `read`, `dailyGoal` and `dayCounts`, which sync through the Supabase `profiles.state` JSON with no migration.
- **Runner fix:** the transaction guard now only blocks statements that begin with COMMIT/ROLLBACK, so `ON COMMIT DROP` works.

## Next phases (dependencies → complexity)
1. **Phase 2: revision, mistakes and proficiency.**
   - Depends on: Phase 1 notes, `lib/insights.ts`, `progress.ts` and the coach (`lib/errorHelp.ts`).
   - Adds: a mistake record on every failed submit (error class, original and corrected SQL, attempt number, source); `/mistakes` on the public site; personal flashcards; a unified `/revision`.
   - Database: Supabase migration `003_learning.sql` (mistakes and flashcards tables with RLS). Medium–high.
2. **Phase 3: interview simulator, report and analytics.**
   - Depends on: Phase 2 proficiency.
   - Adds: timed modes, per-question timing and hints, `/analytics` charts (recharts is already a dependency). Medium.
3. **Phase 4: the `/sql-lab` optimisation lab.**
   - Depends on: the PlanTree component.
   - Adds: EXPLAIN ANALYZE in PGlite, index on/off comparisons, rewrite exercises. Medium.
4. **Phase 5: hardening.**
   - Code-split route components, a Lighthouse budget, a security review of the RLS and the runner guard, and documentation. Medium.
