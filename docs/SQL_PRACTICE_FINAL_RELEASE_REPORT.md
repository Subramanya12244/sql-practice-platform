# SQL Practice visualizer: final release report

Branch `feature/sql-visualizer-restore`, worktree `sql-practice-platform-sqlviz`. Production: https://dataforge.dataforge-learn.workers.dev

| | |
| --- | --- |
| Implementation commit | `37b2f09edba47985f34697db7cf45ab34a9deb15` |
| Pushed | yes: `origin/feature/sql-visualizer-restore` (new branch; not merged to `main`) |
| Cloudflare version | `2e9478c2-32ae-471a-8898-95278511c782` (2026-11-25 10:09 UTC) |

## 1. Where `main` stood

While this work was in progress `main` gained two commits: `0db0b58` (reverts the SQL Query Cinema everywhere) and `0bcf77a` (a brand test fix). Its "Deploy site" workflow deployed them (Cloudflare version `8c9cc477`, 2026-11-24), which replaced two earlier manual deploys of mine that still contained the Cinema. The branch was merged with `main` (`ff76e83`), so this release is a superset of `main`.

- SQL Practice question pages: the upgraded original visualizer (`VizViewClassic`).
- `/query-visualizer`, the business scenarios, the exercise workspace: the plain original `VizView`, as on `main`.
- My Cinema improvements (container layout, CALC/SUM/ROUND/RESULT steps, Expand) are preserved on the local branch `wip/sql-cinema-improvements` (`d52fd9c`). They are not part of this release and were not pushed.

## 2. Release agents

Five actual agents, launched and resumed through the Agent tool. All five were interrupted once by an API rate limit before writing any file and were resumed with the same assignment. R5 was interrupted a second time by a network error and resumed.

| Agent | Task ID | Responsibility | Status |
| --- | --- | --- | --- |
| R1 | `afdc963cb7e883a81` | Mobile query correctness and stale state (P0) | done |
| R2 | `af64758827d85fa24` | Narrow desktop layout, table overflow, loading and empty states; Firefox-mobile hang investigation | done |
| R3 | `afe81b1b044492516` | SUM empty lane and player initialization | done |
| R4 | `ae45b692143053d31` | SQL browser regression across representative queries, three engines | done |
| R5 | `a29ba05f8cb6451ff` | Python environment investigation, full regression, build, accessibility, release verification | done |

Agent 2 (`a071522be15cfe6da`) of the previous round was resumed once to fix a row-count bug found by R4 (section 3, item 7).

## 3. Issues fixed

1. **P0, stale starter-query visualization on a phone (R1).** Root cause in `QuestionPage.tsx`: the "Visualize ↗ tab" button visualized the question's reference solution when nothing had been run; the visualization query was a bare string that nothing invalidated; failed runs counted as "the latest query". Now a pure rule (`lib/visual/classic/vizSource.ts`) decides which query is shown and a notice (`ClassicStaleNotice`) says whether it is the current editor query, the last successful run, or an earlier one. Nothing is shown before a run; the reference solution is never visualized; whitespace and trailing-`;` edits do not count as edits. Only the Visualize panel of `QuestionPage.tsx` changed.
2. **P1, narrow desktop layout (R2).** A compact "Step N of M" bar (previous, play/pause, next) appears whenever the full player has scrolled out of view and never covers content; in the narrow pane "What is happening?" leads the explanation. Container queries, not window breakpoints.
3. **P1, table overflow (R2).** Headers wrap at natural breaks only (`<wbr>` after `.` and `_`), keep a title and accessible name; the first column stays fixed; each table scrolls on its own with a visible hint, edge fade and scrollbar, and is keyboard focusable. No page-level horizontal overflow at 390, 500, 800 or 1440 px.
4. **P1, SUM empty lane (R3).** Three of the four aggregate variants (Output rows, SUM per group, ROUND) ended with an empty left lane. Consumed rows now stay in the left lane and the result appears on the right.
5. **P1, player initialization (R3, R2).** The player read its step count from the playback reducer, which learns it one render late. `ClassicPlayer` takes the real count; the host passes it and renders the player only when the step state exists. Loading ("Visualizing…") and empty ("no steps") states are distinct.
6. **Compact step bar contrast (coordinator).** The filled play button lost its on-accent text colour to a more specific rule (1.56:1 in the light theme); fixed in `classic-ui.css`.
7. **Teaching accuracy (Agent 2).** After HAVING the aggregate step said "in 77" although 5 groups survived. Every card's rows-in now equals the previous card's rows-out; 9 tests compare the numbers with independent queries.
8. **Python tests (R5).** See section 4.

## 4. The 1,187 Vitest failures

Investigated against the repository's intended environment, not assumed. All 1,187 were environmental.

- Failing tests: 1,184 in `siteDaily.test.ts` and 3 in `siteVisualInterview.test.ts`. Messages: Python tracebacks (1,166), non-zero exit status (4), `bash: python: command not found` (8), tracebacks from Python snippets (3).
- Cause: with no `DAILY_PYTHON` and no `.venv-daily`, the tests fall through to Homebrew `python3` 3.14.6, which has no numpy or pandas. CI uses Python 3.13 and `pip install -r frontend/src/site/content/daily/requirements.txt` into `.venv-daily`.
- The unchanged base `0bcf77a` fails the same 1,187 tests, test by test.
- With a Python 3.13.9 venv built outside the repo from the requirements file (numpy 2.5.5, pandas 2.3.3) and `DAILY_PYTHON` pointing to it, both this branch and the base give 4,996 passed, 0 failed, 2 skipped across those two files.
- No test was edited to make this pass. Full evidence: `docs/SQL_PRACTICE_RELEASE_VERIFICATION.md`.

## 5. Validation

| Check | Result |
| --- | --- |
| TypeScript (`tsc --noEmit`, whole project) | clean |
| ESLint (`npx eslint src`) | clean |
| Full Vitest, `DAILY_PYTHON` set, `TZ=UTC` | 171 files, 8,493 tests: 8,483 passed, 0 failed, 10 skipped (2 `siteDaily`, 2 `siteHelpExamples`, 6 `siteSupabaseSyncLive` needing live Supabase credentials). Two earlier attempts while other agents loaded the machine failed with 55 and 68 timeouts only; the suite needs an idle machine. |
| Production build + `check:prerender` | exit 0, 1,139 pages, no failed Suspense boundaries |
| Accessibility (axe-core 4.10.2, wcag2a/aa/21aa) | desktop 1440 and phone 390, light and dark, visualizer open: no violation in any new part. Two known, outside the new code: bold teal on the highlighted editor line at 4.12:1 in the light theme (`site.css`, unchanged from base); an unlabeled Monaco-internal input on phones. Keyboard: rail, player and board are single tab stops, the row inspector closes on Escape with focus returned, no trap. Reduced motion: no transition or animation over 1 ms, none infinite. |
| Browser matrix (R4), 14 queries x light and dark | Chromium desktop: 42 of 42 (whole final spec, clean run). Chromium mobile: 38 of 40 on the earlier run (the two failures were the hydration page-load test and a first-run test since split in two; both fixed or reclassified). Firefox desktop and mobile: 80 of 82 on the earlier run (the two failures were the page-load test, now informational). WebKit desktop: 39 of 41 (the failures were the page-load test and the compact-bar contrast, since fixed). Targeted re-runs after the fixes pass: compact bar on Chromium desktop and mobile (both themes) and WebKit desktop, page-load on Chromium and Firefox desktop. |
| Per query, every engine | Results-panel rows and the visualizer's final result match an independent PGlite reference; rows in and out of every stage match; the SQL highlight, board, tables, explanation and progress report the same step index after every step; no horizontal overflow; no console errors; no `ctid` probe errors. |
| Stale-data tests (R1), Chromium desktop and mobile | 14 of 14 |

Queries covered: SELECT and WHERE, INNER JOIN, LEFT JOIN, three-table JOIN, GROUP BY with SUM, GROUP BY with COUNT, SUM and AVG, HAVING, ORDER BY with NULLs, CTE, subquery, window function, NULL handling, empty result, invalid SQL, Q01.

## 6. Remaining limitations

- **WebKit on a phone profile is not fully validated.** Playing the HAVING query to the end hung the browser twice in the same chunk (once more when retried); other single hangs passed on a retry. WebKit here is slow and unstable with the dev server, and the host clock slept during some runs. It is not known whether this is a product problem.
- **Firefox on a phone:** an earlier run stalled at step 3 of the same query. R2 could not reproduce it on an idle machine (the matrix test passed twice, a 439 s polling probe stayed responsive, the code has no self-triggering listener); the step bar was hardened anyway. Treated as a load artefact, not confirmed.
- **Pre-existing hydration warnings.** The production build, and the live site (which is `main`), intermittently log React errors #418 and #423 on first visits to several pages, including `/` and question pages. They come from a client versus prerender mismatch and are not caused by this branch. Not fixed here.
- **Console noise on a failed query.** Visualizing a failed query logs PGlite failure messages (`relation ... does not exist`, `current transaction is aborted`). They come from the shared `visualize()` engine, which runs five derived queries that all fail; the original did the same. Not a visible fault.
- **Mid-typing notice.** "Current" is judged against the editor's saved draft (saved about 600 ms after typing), so a run made within that window can briefly read "edited", and a query run from a scratch tab reads as "changed the editor".
- **Typo message.** Typing `SELEC ...` shows the practice page's existing "write a SELECT" safety message instead of PostgreSQL's syntax error. Pre-existing and outside the visualizer.
- **SUM default view.** The default "Output rows" variant shows the groups; the contributing values are in "SUM per group", one selector click away.
- **Minor cosmetic:** a lane label is truncated on a phone ("REMOVED 8 of 1…"); the long "What is happening?" text of the SUM step makes the explanation tall.
- **Light-theme highlight contrast** at 4.12:1, from `site.css`, predates this branch.
- **Not tested:** screen readers beyond the ARIA attributes asserted; signed-in grading in the browser; questions other than Q01 in the browser (the data tests cover many more queries).
- **The workspace SQL tests** in `e2e/workspace.spec.ts` fail in this environment on the unchanged base as well (one hung for 17.8 minutes); the cause was not found. Not touched.

## 7. Files

Modified: `frontend/src/site/entry-client.tsx` (two CSS imports), `frontend/src/site/pages/QuestionPage.tsx` (the Visualize panel only).
Added, source: `VizViewClassic.tsx`, `RowFlowClassic.tsx`, `classic-ui.css`, `classic-motion.css`, `components/visual/classic/` (10 files), `lib/visual/classic/` (10 files).
Added, tests: 13 vitest files (`siteClassic*`, `siteSqlPractice*`) and 4 Playwright specs (`sql-practice-original-visualizer`, `sql-practice-visualizer-qa`, `sql-practice-stale`, `sql-practice-release-matrix`).
Added, docs: this report, `SQL_PRACTICE_RELEASE_VERIFICATION.md`, `SQL_PRACTICE_VISUALIZER_QA_REPORT.md`, `SQL_VISUALIZER_ORIGINAL_ARCHITECTURE.md`, `SQL_VISUALIZER_UPGRADE_CONTRACT.md`, `SQL_PRACTICE_ORIGINAL_VISUALIZER_RESTORATION.md`, and 42 screenshots in `docs/images/sql-practice-{original,visualizer,release}/` (about 8 MB).

## 8. Release record

- **Commit:** `37b2f09edba47985f34697db7cf45ab34a9deb15` on `feature/sql-visualizer-restore`, on top of the merge with `origin/main` (`ff76e83`). Staged by explicit path (91 files); no secret, `.env`, generated file or local artifact; the Cinema work-in-progress stayed on the local branch `wip/sql-cinema-improvements` (`d52fd9c`, not pushed).
- **Push:** `git push -u origin feature/sql-visualizer-restore`, a new branch, no force. Not merged to `main`.
- **Deploy:** the repository's own workflow, "Deploy site", run `45589690350`, started with `workflow_dispatch` on the feature branch (the workflow also runs on a push to `main`). It built commit `37b2f09`, and every step succeeded: `npm ci`, TypeScript, lint, the Python environment for the Daily Learning tests, the frontend unit and integration tests, the backend tests, the Python examples check, prerender, the Suspense check and "Deploy to Cloudflare". It builds with the repository's Supabase, Search Console and analytics variables, which my earlier hand-built deploys had not included.
- **Cloudflare version:** `2e9478c2-32ae-471a-8898-95278511c782`, worker `dataforge`.
- **Caveat:** `main` does not contain this work. The next push to `main` redeploys `main` and replaces this version, unless the branch is merged first.

### Production smoke tests

Production URL: https://dataforge.dataforge-learn.workers.dev (Chromium, Chrome channel).

| Check | Result |
| --- | --- |
| Sanity sweep of 13 pages: `/`, `/questions`, `/questions/q01-product-revenue`, `/login`, `/query-visualizer`, `/practice/python`, `/visual`, `/workspace`, `/learn`, `/progress`, `/scenarios`, `/study-notes`, and a bad URL | all as expected (200, the bad URL 404); no page error, console error or CSP violation; no horizontal page scroll; sign-in form present; the security policy header is served |
| `sql-practice-original-visualizer.spec.ts`, `sql-practice-stale.spec.ts`: SQL Practice opens, the upgraded original visualizer is rendered (five tabs, playback, row board), no Cinema element, execution and final result match, stepping, stale and failed-query behaviour, desktop and mobile | 36 passed (22 + 14), 0 failed |
| `sql-practice-release-matrix.spec.ts`, subset (HAVING, ORDER BY, Q01, stale data and editing, compact step bar), desktop and mobile, light and dark | 30 passed, 0 failed |

These cover: SQL Practice opening, the original visualizer rendered and the Cinema absent, query execution, intermediate data compared with an independent reference, synchronised explanation and step state, playback, failed queries not showing a misleading stale visualization, desktop and mobile layouts, light and dark themes and no critical console errors. Firefox and WebKit were run on the production build before the deploy (section 5), not on the live site.
