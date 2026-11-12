# Query Visualizer UX correction: SQL Query Cinema

Branch `feature/query-cinema-ux`. Working-tree changes only: nothing is committed, pushed, merged or deployed.

Goal: a learner enters a JOIN + GROUP BY query, presses Visualize, and sees the input tables, the matching rows, the filtered rows, the grouped records, the aggregate calculations and the final output, through an animation they control.

## Root cause

The page ran the right queries but did not show them. The engine was already real: `visualize()` measures every stage with a derived query, and `traceRows()` returns real rows with a real identity (`ctid`). What failed was the interface on top of it.

1. The first screen was a form. A large editor, a row of presets and a button came first; the stages sat below the fold as a list of tables and counts. A learner saw text and numbers, not movement.
2. The row animation (`RowFlow`) was a secondary panel inside a stage card. It drew one-line chips that only moved from "input" to "kept" or "removed". It never showed why a row moved: no per-row condition result, no join partners, no group membership, no aggregate arithmetic.
3. Some stages had no board at all: FROM and JOIN were one step, and HAVING and the group aggregates had no row-level data, so GROUP BY and HAVING looked like a count changing.
4. The controls (play, step, speed) were small and scrolled out of reach while a stage was on screen.
5. The spec's own example (`HAVING COUNT(o.order_id) > 2` after `WHERE o.freight > 50`) returns 0 rows on the bundled Northwind subset. With no kept rows and no explanation, the page looked broken (see Findings).

## What changed

| Area | Before | Now |
| --- | --- | --- |
| Page | Form first, stages below | Header, example chips (click = load and play), 128 px editor strip, Visualize and a status line; the cinema fills the rest. Before a run, a ghost pipeline shows what will play |
| Pipeline | List of stages | A rail of every logical stage with its exact rows in and out; earlier stages ticked, the current one lit, later ones dashed. Click any stage |
| Stages | FROM+JOIN as one step | FROM, one JOIN step per join, WHERE, GROUP BY, HAVING, SELECT, DISTINCT, ORDER BY, LIMIT. Built from the parsed query, so the step list does not change when row data arrives |
| Canvas | Chips | Table-style cards with column headers; key columns marked; lanes with exact counts (`12 of 98`) |
| JOIN | Rows listed | Left rows, right rows, result. Matching rows share a colour per left-row family; links are drawn; rows with no partner go to Removed (INNER) or are padded with NULL (LEFT) |
| WHERE | Rows moved | Three beats: rows sit in the input, each shows its predicate result (`true`, `false`, `NULL`), then true rows travel to Kept and false or NULL rows to Removed |
| GROUP BY | Count change | Rows collect into coloured buckets; each bucket shows its aggregate (`orders = 13`) |
| HAVING | Count change | Each group shows the aggregate value and its verdict against the condition |
| SELECT, DISTINCT, ORDER BY, LIMIT | Partly | Groups become output rows; duplicates merge (`×3, 2 merged in`); rows reorder (`#7 → #1`); LIMIT keeps N and marks the rest cut |
| Teaching | Static text | Four answers per stage: What SQL does here, Why this stage, Which rows changed (exact counts), If this clause were removed (exact counts). The stage's clause is highlighted in the query. The exact SQL fragment is in a details block |
| Controls | Small bar | Restart, Previous, Play/Pause, Next, scrubber, speed, "Step N of M". Sticky at the bottom. Keys: Space, left and right arrows, Home, End |
| Motion | One style | Reduced motion (system or the in-page setting) shows static Before and After boards with the same verdicts and counts; no transitions |
| Theme and mobile | Light or dark by site setting | `.cinema-dark` scope for the cinema; lanes scroll inside the canvas on narrow screens; the page never scrolls sideways |

## Architecture

```
SQL text
  -> visualize()        (existing) stages with real counts from derived queries, run once, rolled back
  -> traceRows()        (existing, extended) real rows per stage: ctid identity, WHERE verdicts,
                         group aggregates, HAVING verdicts; read-only queries only
  -> buildCinema()      (new, pure) the script: one CinemaStep per thing SQL does, with counts,
                         board, text, fragment. No I/O
  -> QueryCinema        (new) rail, counts, SQL strip, insights, sticky controls
       -> RowFlow       (rewritten) the canvas: three-beat animation, or static Before/After
```

- No second SQL engine. The cinema reads what `visualize()` and `traceRows()` already measured; the only new queries are read-only `SELECT`s that return a verdict or an aggregate for rows already traced.
- Stepping, scrubbing, replaying and restarting never run SQL. The script is built once (memoised on the visualization, the trace and the text).
- Logical order only. The note on screen says PostgreSQL may run the query differently; the Execution plan tab shows the physical plan.
- Playback never touches grading. The visualizer has no grading path, and the cinema imports none.
- Files: `lib/visual/cinema.ts` (new), `lib/visual/rowFlow.ts` and `rowTrace.ts` (extended), `components/visual/QueryCinema.tsx` (new), `RowFlow.tsx` (rewritten), `HighlightedSql.tsx` (extracted), `components/VizView.tsx`, `pages/QueryVisualizerPage.tsx`, `site.css` (`.cinema-dark`), `help/content/sql.ts` (Guide tour and text updated to the new layout).

## Screens

Desktop 1440 x 900 (left) and mobile 390 x 844. The query is the first preset: `JOIN + GROUP BY + HAVING` on Northwind.

| Stage | Desktop | Mobile |
| --- | --- | --- |
| Before Visualize | ![](images/query-cinema/00-before-visualize-desktop.png) | ![](images/query-cinema/00-before-visualize-mobile.png) |
| FROM (91 rows) | ![](images/query-cinema/01-from-desktop.png) | ![](images/query-cinema/01-from-mobile.png) |
| FROM, the table | ![](images/query-cinema/02-from-desktop.png) | ![](images/query-cinema/02-from-mobile.png) |
| JOIN (91 to 100) | ![](images/query-cinema/03-join-desktop.png) | ![](images/query-cinema/03-join-mobile.png) |
| WHERE (100 to 98) | ![](images/query-cinema/04-where-desktop.png) | ![](images/query-cinema/04-where-mobile.png) |
| GROUP BY (98 to 21) | ![](images/query-cinema/05-group-by-desktop.png) | ![](images/query-cinema/05-group-by-mobile.png) |
| HAVING (21 to 12) | ![](images/query-cinema/06-having-desktop.png) | ![](images/query-cinema/06-having-mobile.png) |
| SELECT | ![](images/query-cinema/07-select-desktop.png) | ![](images/query-cinema/07-select-mobile.png) |
| ORDER BY | ![](images/query-cinema/08-order-by-desktop.png) | ![](images/query-cinema/08-order-by-mobile.png) |
| LIMIT (12 to 5) | ![](images/query-cinema/09-limit-desktop.png) | ![](images/query-cinema/09-limit-mobile.png) |
| Reduced motion (static boards) | ![](images/query-cinema/10-reduced-motion-desktop.png) | ![](images/query-cinema/10-reduced-motion-mobile.png) |
| HAVING removes every group | ![](images/query-cinema/11-all-groups-removed-desktop.png) | ![](images/query-cinema/11-all-groups-removed-mobile.png) |
| LEFT JOIN, unmatched rows | ![](images/query-cinema/12-left-join-desktop.png) | ![](images/query-cinema/12-left-join-mobile.png) |
| DISTINCT, merged duplicates | ![](images/query-cinema/13-distinct-desktop.png) | ![](images/query-cinema/13-distinct-mobile.png) |

Screenshots are written by `CINEMA_SHOTS=1 npx playwright test e2e/query-cinema.spec.ts` (each waits for the beats to finish).

## Tests

| Suite | What it proves | Result |
| --- | --- | --- |
| `siteQueryCinemaData.test.ts` (31, real PGlite) | Step order and exact funnel; JOIN keys equal on both sides and partners share a colour; INNER drops unmatched rows, LEFT keeps them with NULL; every WHERE verdict agrees with the data; NULL is not true; drawn rows are a sample while counts are exact; group aggregates and HAVING verdicts match; empty Kept lane; DISTINCT, ORDER BY, LIMIT; final board equals the real result; CTE, subquery, UNION, window, CASE and NULL queries still play; large results sampled with exact totals; building, stepping, seeking and restarting issue no SQL; only SELECT, WITH, EXPLAIN are used | 31 passed |
| `siteQueryCinemaUi.test.tsx` (17, jsdom + real PGlite) | Rail, counts, insights, playback controls and keys, static boards under reduced motion (no transition or animate classes), table-only fallback | 17 passed |
| `e2e/query-cinema.spec.ts` (16 per project) | In a real browser: layout and sticky controls; 8 rail stages with counts; FROM and JOIN tables, tones and groups; WHERE beat order (still in input while evaluated, then Kept at 100% and Removed at 200% lane offset); GROUP BY buckets with `orders = N`; HAVING verdict equals count test; SELECT, ORDER BY, LIMIT; final rows `France 13, Germany 13, USA 13, Brazil 9, UK 8`; play, pause, step back, scrub, speed, restart; keyboard; rail jumps; insights; reduced motion; zero-row query; LEFT JOIN, DISTINCT, UNION; no horizontal scroll | desktop 16 passed; mobile 15 passed, 1 skipped (keyboard shortcuts are desktop-only) |
| Existing visualizer and help e2e (`visual.spec.ts`, `visual-engines.spec.ts`, `help-tours.spec.ts`), desktop and mobile | No regression | 66 passed, 1 skipped; the tour spec failed once on a stale selector for the example chips (changed class), fixed in `help/content/sql.ts`, then 1 passed |
| Full Vitest (`TZ=UTC`) | No regression | 109 files, 6782 passed, 10 skipped, 0 failed |
| `tsc -b`, ESLint (`src`) | | clean |

Not run: Firefox and WebKit for the cinema spec; production checks; `sync.spec.ts` (needs Supabase).

## Findings

- The spec's example query returns no rows on this Northwind subset: 73 rows after WHERE, 67 groups, and HAVING `COUNT(o.order_id) > 2` removes all of them. The cinema shows this honestly (`0 of 0` kept, "Final result (0 rows)"). It is a preset ("Customers with many large orders") and has a test. The first preset (`HAVING COUNT(*) >= 3`) gives a visible result.

## Remaining limitations

- Boards draw a sample: at most 20 rows, in practice 12 kept and 8 removed, with `+N more rows not drawn`. Counts, verdicts and aggregates are exact for the drawn rows; the lane counts are exact for all rows.
- HAVING verdicts and group aggregates are traced for the first 500 groups.
- Set-operation ORDER BY and LIMIT, window functions, and SELECT without aggregates show a table and the exact counts, not a moving board ("table only" view).
- After a stage moves rows out, the Input lane can be empty; this is the intended end state but can look sparse.
- On phones each lane scrolls inside the canvas; the three lanes do not fit side by side below about 640 px.
- A first visit shows the Guide's welcome card, which can sit over the page until it is dismissed.
- The cinema runs on the Northwind sample only. Verified in Chromium; Firefox and WebKit not run for this spec.
- Not released: this work is uncommitted on `feature/query-cinema-ux`.
