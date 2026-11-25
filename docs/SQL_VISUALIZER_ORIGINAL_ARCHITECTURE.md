# SQL Practice visualizer: the original, its architecture and the gaps to close

Branch `feature/sql-visualizer-restore`, worktree `sql-practice-platform-sqlviz`. Written by Agent 1 (original and architecture) for the five-agent upgrade described in `docs/SQL_VISUALIZER_UPGRADE_CONTRACT.md`. Nothing here was committed or deployed.

Everything below was checked in the code or in a real run. Where something is only read from code and not run, the text says so.

## 1. Summary

- The original visualizer is the pre-Cinema `VizView` of commit `cb29eff` (the parent of the Cinema commit `9be309e`). Its engine, the row-flow code, was added on 2026-11-12 in `3e82e31` (Visual Learning Engine V1 + V2).
- Its recovered copy in this tree (`components/VizViewClassic.tsx`, `components/visual/RowFlowClassic.tsx`, `lib/visual/classic/rowFlow.ts`, `rowTrace.ts`) is identical to `9be309e^` except for import paths, a header comment, the component name and two helpers that lost their `export`. Verified with `git diff` (section 3).
- The Visualize panel in `pages/QuestionPage.tsx` is the same as at `9be309e^`. The only differences are the swap `VizView` to `VizViewClassic` and two unrelated additions (`WorkspaceLink`, an icon in the history list).
- Lost functionality: none found. Nothing the original did is missing from the recovered files or from the panel that hosts them.
- The original has real defects of its own that the restoration carried over. I reproduced them in Chrome (section 7): a pinned "Before" board survives a step change, playback keeps running while the learner is on another tab, the learner's own SQL error is hidden behind a misleading message, the keyboard shortcuts only work when the playback bar has focus. One of them (the misleading message) is a shared-engine bug that also hits the Cinema.
- The state is split across several holders in the host, the board and the page (section 6.4). `ClassicStep` already fixes the five that matter for the step; three more must be folded in or reset (the board's `view`, the flow diagram's `picked`, and playback that is not paused when the tab changes).

## 2. What the original is, and what made it effective

### 2.1 Feature inventory (from the code of `VizViewClassic.tsx` and `RowFlowClassic.tsx`)

| Feature | Where | Detail |
| --- | --- | --- |
| Five tabs | `role="tablist"` | Logical steps, Flow diagram, Relationships, Structure, Execution plan. A query the stage walker cannot handle (`viz.unsupported`) opens on Structure. |
| Stage buttons | `ol aria-label="Stages"` | One button per `viz.stages[i]`, labelled with the clause (FROM, WHERE, GROUP BY, HAVING, SELECT, ORDER BY, LIMIT, UNION ...). `aria-current="step"` on the active one. FROM and the joins are one stage. |
| Clause highlight | `HighlightedSql` | The query text with the active clause range in a `<mark>` coloured per clause (`CLAUSE_COLOR`). The range comes from `stage.range` (set operations) or `parsed.ranges`. |
| Editor highlight | `onClause(range or null)` | Called on every step change while the Logical tab is open, with `null` when the learner leaves it. `QuestionPage` hands it to `highlightInEditor`, which decorates the Monaco editor. |
| Stage card | `StageView` | Title, provenance badge (Executed or Parsed), explanation, rows in and out, "% filtered out", "+N rows added (fan-out)" or "100% retained". |
| Join detail | `StageView`, `s.joins` | Per join: kind, ON text, matched pairs, a five-cell grid (left, right, matching pairs, unmatched left, unmatched right), a fan-out warning, an unmatched-rows note that says whether the rows are kept or dropped, and a sample of unmatched rows on each side. |
| Per-stage tables | `StageView` | `Rows at this stage (first N)`, `Removed at this stage (sample)`, window partitions, and a collapsed "Query used for this stage". |
| Row-movement board | `RowFlowClassic` | Lanes and cards with a before and an after slot, drawn from the stage's real rows. Tones: kept, removed, matched, unmatched, duplicate, survivor, group, new, cut. Legend, a "sample" note when rows are not drawn, an identity line ("real (ctid)" or "trace (matched by content)"). A "Join step" select when a FROM has several joins. |
| Replay, Before, After | `RowFlowClassic` | Replay restarts the move. Before and After pin the board to one end. Hidden under reduced motion. |
| Reduced motion | `MotionToggle` + `useReducedMotion` | Follow system, Reduce, Full. Under reduced motion the board is two static boards (Before, After) with the same tones. `aria-live` sentence in both modes. |
| Playback bar | `PlaybackBar` from `visual/Playback.tsx` | Restart, Previous step, Play or Pause, Next step, speed 0.5x to 4x, "Step n of m", a timeline slider. Keys Space, arrows, Home, End when the bar has focus. Auto-advance by timer. |
| Set operations | `SetOpView` | Rendered under the board when `stage.setOp` exists (UNION, INTERSECT, EXCEPT): both inputs, compatibility, matches, removals, result. |
| Flow diagram | `QueryDiagrams mode="flow"` (lazy) | A graph of the clauses; clicking a box selects its range, shows it in `HighlightedSql` and sends it to `onClause`. |
| Relationships | `QueryDiagrams mode="rel"` | Tables, join type and columns; PK and FK from the database catalog; dashed lines for foreign keys the query does not join on. |
| Structure | inline | Statement type, tables, joins, CTEs with row counts and a mermaid data-flow, set-operation branches with row counts, subquery and window counts. |
| Execution plan | `PlanTree` | `EXPLAIN (FORMAT JSON)` tree; a confirm()-gated `EXPLAIN ANALYZE` button that waits for the row trace to finish first, so the two never overlap. |
| Final result | `SampleTable` | "Final result (N rows)" from the one real run of the learner's query. |
| Provenance badges | `SourceBadge` | Executed, Parsed, Plan, Estimated, each with a tooltip. |
| Session summary | `onDone(VizSummary)` | Called once per `(body, dataset)` with structure text, stage list, plan cost and root, volatile functions. `QuestionPage` stores it as a `VizSession` in the history tab. |
| Error handling | `StageView.error`, `visualize()` | A stage that fails shows "Rows for this stage couldn't be computed (...)". If the learner's query itself fails, `visualize()` appends a stage titled "Your query has an error" holding the message. Volatile functions (random, now, nextval) switch every derived query off and show a banner. |

### 2.2 Why it works

1. One question per screen: "which rows are left after this clause". The stage is the unit, the clause is highlighted in the learner's own text, and the counts in and out are exact.
2. Every number is real. Counts and samples come from derived SELECTs over the learner's own clauses; the final result is the learner's query run once. The identity line says honestly whether rows were followed by `ctid` or matched by content.
3. It is logical order, labelled as such, with the physical plan on a separate tab, so it never claims what PostgreSQL did.
4. The board shows rows move (removed rows dashed, matched rows tinted, groups as buckets), so the learner sees where rows disappear or multiply, which is exactly what a wrong answer needs.
5. It is small: one playback reducer, one board, one stage card. Nothing competes for attention.

## 3. Git evidence

| Commit | Date | What | Used for |
| --- | --- | --- | --- |
| `7ae4fcc` | 2026-11-04 | Phase 3: integrated visualizer | First `VizView`. |
| `6d29fef` | 2026-11-06 | Flow diagram: click a stage to highlight its clause | Origin of `onClause` from the diagram. |
| `3e82e31` | 2026-11-12 | Visual Learning Engine V1 + V2 | Adds `Playback.tsx`, `playback.ts`, `RowFlow.tsx` (153 lines), `rowFlow.ts` (566), `rowTrace.ts` (309), `SetOpView.tsx`, `setOps.ts`, `motion.ts`, `MotionToggle.tsx`; `VizView` +41 lines. This is the engine of the original. |
| `cb29eff` = `9be309e^` | 2026-11-12 | Last commit before the Cinema | The reference. |
| `9be309e` | 2026-11-13 | SQL Query Cinema | In `frontend/src/site`: 10 files, +830 -142. New `QueryCinema.tsx` (161), `HighlightedSql.tsx` (16), `cinema.ts` (246). `RowFlow.tsx` +228, `rowFlow.ts` +77, `rowTrace.ts` +52, `VizView.tsx` rewritten (the stage buttons, board and player replaced by `<QueryCinema>`), `QueryVisualizerPage.tsx` +91, `help/content/sql.ts` +8 -8 (tour text now says "This is the Query Cinema"; that tour targets `/query-visualizer` only). |
| `5aad56a` | 2026-11-18 | Unified exercise workspace | Wraps the Cinema; `VizView` exports `StageView` and re-exports `HighlightedSql`. |
| `4e4acb9` | current `main` | Visualizers teach through animation; SQL workspace view "back to the original" | Adds `workspace/visualizers/sql/ClassicSqlVisualizer.tsx`. Its comment calls the visualizer "the original", but it renders today's `VizView`, which is the Cinema. The workspace therefore shows the Cinema. This is intended (the contract keeps it) but the comment is misleading. |
| `0db0b58` | 2026-11-20 | Local commit "Revert the 2026-11-13 Query Cinema redesign" | Not an ancestor of `HEAD`; it lives on `feature/dataforge-guide`. Its `RowFlow.tsx`, `rowFlow.ts` and `rowTrace.ts` are identical to `9be309e^`; `VizView.tsx` differs by `export` on `StageView` (2 insertions, 1 deletion). Confirms the recovered files are the true originals. It deletes the Cinema everywhere, so it cannot be merged with this branch. |

Diffs run for this document (all from `frontend/src/site`):

- `git show 9be309e^:.../VizView.tsx` against `components/VizViewClassic.tsx`: header comment added; imports point at `RowFlowClassic` and `lib/visual/classic/rowTrace`; `SourceBadge` and `HighlightedSql` lost `export`; `VizView` renamed `VizViewClassic`. Nothing else. (That was the state when I read it; Agent 3 is now rewriting the host, see section 6.)
- `9be309e^:.../RowFlow.tsx` against `RowFlowClassic.tsx`: one line, the import of `classic/rowFlow`.
- `9be309e^:.../rowFlow.ts` and `rowTrace.ts` against `lib/visual/classic/rowFlow.ts` and `rowTrace.ts`: relative import paths only (3 and 4 lines).
- `git diff 9be309e^ -- pages/QuestionPage.tsx`: `VizView` to `VizViewClassic` (import and element), plus `WorkspaceLink` and an `Icon` in the history list. The panel (`Panel id="visualize"`: the empty-state text, the "Visualize my (latest) query" button, `key={vizSql}`, `onClause`, `onDone`, `ExplainPanel`) is unchanged.

## 4. Cinema versus original

| Aspect | Original (SQL Practice now) | Cinema (`/query-visualizer`, scenarios, workspace) |
| --- | --- | --- |
| Stage list | One button per stage; FROM + JOIN is one stage. | A rail of steps (`CinemaStep`), one per join, plus CALC, SUM, ROUND, RESULT for a plain GROUP BY with an aggregate. Step index is not the stage index. |
| Counts | Chips "in" and "out", % filtered or +N added. | Big "in -> out" with a delta badge, also in each rail button. |
| Board | Lanes, cards, tones, Replay, Before, After, join-step select. | Same family, plus per-row WHERE and HAVING verdicts, matched rows sharing a colour, group colours, worked rows, a container-query layout. |
| Words | `s.explanation` plus the stage card. | Four answers per step: what SQL does, why, which rows changed, what if removed. |
| Stage tables and join detail | Always visible under the board. | Collapsed in a `<details>`. |
| Player | `PlaybackBar` at the end of the card; keys only when the bar has focus. | Sticky bar; keys (Space, arrows, Home, End) work anywhere in the section; Expand dialog that moves the section to `<body>`. |
| Reduced motion | Static Before and After boards. | Same. |
| Teaching depth | Light: the sentence and the numbers. | Deeper, but the board was squeezed in the question pane (see `SQL_VISUALIZER_REGRESSION_REPORT.md`). |

What the Cinema added: separate JOIN step, predicate verdicts, the four answers, aggregate arithmetic, Expand, page-wide keys. What the original has that the Cinema lacks or hides: stage buttons named after clauses so the learner can jump by clause, the full stage card always on screen (join grid, fan-out and unmatched notes, removed-rows sample) and the "Replay, Before, After" next to a board that fits a narrow pane. The agents' goal is to give the original the Cinema's teaching depth without importing the Cinema.

## 5. Lost or broken functionality

### 5.1 Lost in the SQL Practice integration: none found

Verified by diff (section 3) and by a run: on the recovered host in Chrome at 1440 x 900 the five tabs, the six stage buttons for a WHERE / GROUP BY / HAVING / ORDER BY query, the playback group, Replay / Before / After, the Final result table, the editor highlight (`.viz-clause-highlight` spans in Monaco), the reduced-motion static boards (one `rowflow-static`, two boards, no Replay button), the execution plan and the Structure tab all worked. Help tours: the `query-visualizer` tour (its "This is the Query Cinema" step) targets `/query-visualizer`; the question page tour step 6 targets `#tab-visualize`. No tour mentions a layout the original lacks.

### 5.2 Broken in the original, carried over (reproduced)

Run on the recovered host, dev server on port 5185, query `SELECT c.country, COUNT(*) AS n, SUM(o.freight) AS f FROM customers c JOIN orders o ON o.customer_id = c.customer_id WHERE o.freight > 5 GROUP BY c.country HAVING COUNT(*) > 5 ORDER BY n DESC` at `/questions/q01-product-revenue`.

| # | Finding | Evidence | Severity |
| --- | --- | --- | --- |
| B1 | A pinned "Before" survives a step change. The board stays at "Rows before this stage" on the next stage, and the button still shows pressed. | After "Before", then "Next step": `Step 2 of 6`, mark `WHERE o.freight > 5`, `Before` `aria-pressed="true"`, board label `Rows before this stage`. Cause: `view` in `RowFlowClassic` is local state, never reset when `key` (`stageIndex:clause`) changes. | Medium: board phase and step disagree. |
| B2 | Playback keeps running while the learner is on another tab. | Play, open Structure, wait 4.5 s, return: `Step 4 of 6`, button `Pause`; later `Step 6 of 6`. Cause: `usePlayback`'s timer does not know the tab. | Low to medium. |
| B3 | The learner's own SQL error is hidden. For `SELECT * FROM does_not_exist` the visualizer opens on FROM ("could not be computed (current transaction is aborted, commands ignored until end of transaction block)"), badge PARSED, "Step 1 of 3". The real message ("relation ... does not exist") sits in step 3, the stage "Your query has an error", and is not surfaced. | Run in Chrome. The "transaction is aborted" text is a cross-talk bug, reproduced in isolation (B4). | High for learning: wrong query, wrong explanation. |
| B4 | `runQuery` calls are not serialised. Each call is `BEGIN ... ROLLBACK` on one connection, so two overlapping calls share a transaction, and one failure poisons the other. The host starts `visualize()` and `EXPLAIN` together in `Promise.all`. | Node script on PGlite with `sqlRunner.execute`: three overlapping calls, one on a missing table, returned `relation "nope" does not exist` then `current transaction is aborted ...` twice. The same three run one after another succeed. | High: shared engine (`lib/sqlRunner.ts`, `lib/browserDb.ts`, read-only for everyone); the Cinema has the same call pattern. |
| B5 | Keyboard shortcuts only act when the playback group has focus. | ArrowRight with the page focused: `Step 4 of 6` unchanged. With the group focused, ArrowLeft: `Step 3 of 6`. The Guide text for `/query-visualizer` promises arrow keys; the Cinema listens on its root. | Low. |
| B6 | If `traceRows` rejects, `trace` stays `null`, so `refining` stays true and the board says "looking up real row ids..." for ever (when the frame came from the stage sample). Read from code (`.catch(() => undefined)` then `refining={!trace || ...}`); not run. | `VizViewClassic.tsx` (recovered) lines for `traceRows` and `RowFlow refining`. | Low. |
| B7 | The flow-diagram click sets a clause (`picked`) that is independent of the playback index and is never cleared. The editor highlight shows the picked clause while the Logical tab would show another; returning to the Flow tab shows the old `picked` SQL. Read from code; the click itself was not driven in the browser (the diagram nodes have no stable selector). | `setPicked(r); onClause?.(r)` in the recovered host. | Low. |

None of these is a regression against `9be309e^`. All of them exist there. They matter because SQL Practice is now the original again, and the upgrade must not copy them forward.

## 6. Integration point, dependency graph and execution contracts

### 6.1 Integration point

`pages/QuestionPage.tsx`, `Panel id="visualize"`. It renders `<VizViewClassic key={vizSql} sql={vizSql} onClause={...} onDone={...} />` when the learner presses "Visualize my (latest) query" or "Visualize" in the history list. `key={vizSql}` remounts the whole visualizer for a new query, so all host state resets. The panel also shows `ExplainPanel` (not part of the visualizer). `QuestionPage` is read-only for all agents.

### 6.2 Dependency graph (arrows are imports; "classic" is owned by the upgrade, the rest is shared and read-only)

```
pages/QuestionPage.tsx
 └─ components/VizViewClassic.tsx                              (Agent 3)  host: owns every async load and the tab
     ├─ lib/browserDb.runQuery(sql, dataset)                   shared engine: PGlite worker, one BEGIN..ROLLBACK per call, 8 s timeout
     ├─ lib/visualize.visualize(sql, run)                      shared: stages + final (runs the learner's query once)
     │     └─ lib/sqlClauses, lib/sqlAst (volatileFunctions), lib/visual/setOps
     ├─ lib/visual/classic/rowTrace.traceRows(sql, run, viz)   (Agent 2)  frames aligned with viz.stages
     │     └─ lib/visual/classic/rowFlow.ts                    (Agent 2)  pure frames and boards; imports lib/visualize types, lib/visual/setOps
     ├─ components/visual/Playback.usePlayback(count)          shared: playbackReducer + timer; lib/visual/playback.ts
     ├─ components/visual/classic/useClassicStep.ts            (Agent 4)  ClassicStep from (viz, trace, pb)
     │     ├─ lib/visual/classic/contract.ts                   (coordinator)  ClassicStep, TeachCard, TableSnapshot
     │     ├─ lib/visual/classic/teach.ts                      (Agent 2)  buildTeach, teachSteps
     │     └─ lib/visual/classic/rowFlow.baseFrame
     ├─ components/visual/RowFlowClassic.tsx                   (Agent 4)  board: Replay, Before, After, static boards
     │     └─ lib/visual/playback.frameDelay, lib/visual/classic/rowFlow
     ├─ components/visual/classic/ClassicSql, ClassicPlayer    (Agent 4)  highlight text, player (wraps shared PlaybackBar)
     ├─ components/visual/classic/ClassicStepRail, ClassicExplain, ClassicTables, ClassicTable, stepCopy   (Agent 3)
     ├─ components/visual/SetOpView.tsx                        shared: renders stage.setOp
     ├─ components/visual/MotionToggle.tsx + lib/visual/motion shared: reduced-motion preference (localStorage + "visual-motion" event)
     ├─ components/QueryDiagram.tsx (lazy)                     shared: flow and relationship diagrams; useSchemaKeys loads getSchemas and getKeys
     ├─ lib/queryGraph.buildGraphs(sql)                        shared: pgsql-ast-parser, no database
     ├─ lib/sqlAst.analyze, cteFlow                            shared: structure
     ├─ components/PlanTree.tsx + parsePlan                    shared: EXPLAIN JSON tree
     └─ components/SampleTable, Markdown, Link                 shared
```

The Cinema (`VizView`, `QueryCinema`, `cinema.ts`, `aggDetail.ts`, `HighlightedSql`, the non-classic `RowFlow`, `rowFlow`, `rowTrace`) hangs off `QueryVisualizerPage`, `ScenarioPages` and `workspace/visualizers/sql/ClassicSqlVisualizer` (and the legacy workspace `SqlVisualizer`, `DetailPanels`, `PlanPanel`). Nothing in the classic layer imports it, and nothing outside `QuestionPage` imports the classic layer. `src/test/siteClassicArchitecture.test.ts` enforces both.

### 6.3 Execution contracts

| Contract | Input and output | Rules the classic layer relies on |
| --- | --- | --- |
| `runQuery(sql, dataset = "northwind")` in `lib/browserDb.ts` | `ExecuteResult { success, columns, rows, row_count, message, error_type }` | Each call runs `BEGIN`, the SQL, `ROLLBACK` in `lib/sqlRunner.runRaw`. Transaction-control statements are refused. A call over 8 s kills the worker (`resetDb`), which affects every overlapping call. Calls are not serialised (B4). |
| `visualize(sql, run)` in `lib/visualize.ts` | `Visualization { parsed, stages[], final?, volatile?, unsupported? }` | Stages are in logical order; each has `clause`, `title`, `explanation`, `rowsIn`, `rowsOut`, `sample` (at most 20 rows), `removed`, `joins`, `setOp`, `partitions`, `range`, `error`, `source` (`executed` or `parsed`). `final` is the learner's query run once with the real runner. A failing query adds a last stage "Your query has an error". Volatile functions turn every derived query off. `unsupported` gives no stages. Step count equals `stages.length`; that is the playback count. |
| `traceRows(sql, realRun, viz)` in `lib/visual/classic/rowTrace.ts` | `RowTrace { identity, frames[], notes[], queries }` | Read-only derived SELECTs through the same runner. `frames[i]` is aligned with `viz.stages[i]` and is always a `FlowFrame` (the stage sample when rows could not be traced). Uses `ctid` where it can, else content hashes. Never changes the learner's run. Per-stage failures are caught and noted; only a failure outside a stage rejects. Volatile queries run nothing. |
| `usePlayback(count)` in `components/visual/Playback.tsx` | `{ index, playing, speed, count, dispatch }` | Reducer actions: play, pause, toggle, next, prev, restart, seek, speed, tick, count. `next`, `prev`, `restart`, `seek` pause. A timer sends `tick` every `frameDelay(speed)`. `count` clamps the index. One call in the classic layer, in the host. |
| `ClassicStep` in `lib/visual/classic/contract.ts` | `{ index, count, stage, range?, frame?, teach, progress, playing }` | Derived by `useClassicStep(viz, trace, { index, count, playing })` in a `useMemo` over `[viz, trace, pb.index, pb.playing]`. `index` is the stage index. This is the only thing the highlight, board, tables, explanation and progress may read. |
| `SetOpView({ data })` | `SetOpData` | Rendered only for a set-operation stage. |
| `QueryDiagrams({ mode, flow, rel, dataset, onSelect })` | `onSelect(range or null)` | Lazy; a click reports the clause range. |
| `PlanTree({ plan })`, `parsePlan(rows[0][0])` | EXPLAIN JSON | `EXPLAIN ANALYZE` runs the query: the host asks the learner to confirm and waits for the trace. |
| `onDone(VizSummary)` | `{ structure, stages[], planCost?, planRoot?, volatile? }` | Once per `(body, dataset)`, after all stage and plan loading. |
| `onClause(range or null)` | character range into the trimmed SQL | While the Logical tab shows a step; `null` otherwise. `highlightInEditor` finds the text in Monaco. |

### 6.4 Where state lives, and where it can disagree

State holders in the host (`VizViewClassic`), the board (`RowFlowClassic`) and `QuestionPage`:

| # | State | Owner | Meaning | Can disagree with the step? |
| --- | --- | --- | --- | --- |
| S1 | `pb` = `usePlayback` `{ index, playing, speed, count }` | host | Which stage is current, and whether it is auto-advancing. The single source of truth. | It is the reference. |
| S2 | `tab` | host | Which of the five views is open. Gates `onClause`. | Yes: playback is not paused when `tab` changes (B2). Returning re-sends the clause, but the index moved. |
| S3 | `picked` | host | The clause range chosen in the flow diagram. | Yes: independent of S1, never cleared (B7). The editor can show it while the Logical highlight says another clause. |
| S4 | `trace` `{ viz, t }` | host | Row-level frames, loaded after the stages. | Not an index disagreement, but the frame behind step `i` changes under the learner when the trace arrives (the `baseFrame` fallback is swapped for the real frame). A rejected trace leaves `null` (B6). |
| S5 | `view` (`play`, `before`, `after`), `replay`, `variant`, `done` | `RowFlowClassic`, local | Board phase, replay counter, which join step, animation finished. | Yes: `view` is never reset when the stage changes (B1). `variant` is keyed by stage and clause, so it resets. `done` is keyed by `animKey`. |
| S6 | `reduced` (`useReducedMotion`), plus `pref` inside `MotionToggle` | host and toggle | Static versus animated board. | They agree through localStorage and the `visual-motion` event. Not a step issue. |
| S7 | `RowFlowClassic` falls back to `baseFrame(stage, prev, stageIndex)` when no `frame` prop arrives | board | A second derivation of the frame. | Yes if it ever differs from `ClassicStep.frame`: the board must take `frame` only. |
| S8 | Host loads: `busy`, `v`, `st`, `plan`, `analyzed`, `counts`, `graphs` | host | Per-query data, not per-step. | No. |
| S9 | `vizSql`, `sessions`, `execs` | `QuestionPage` | Which query is visualized, history. `key={vizSql}` remounts the host. | No. |
| S10 | The editor decoration in Monaco | `highlightInEditor` (module variable `decorations`) | The highlighted range. | Yes if a flow click (S3) or a late effect runs after a step change. |

In the recovered host the stage card, the highlight and the explanation all read `stages[pb.index]`, so they agree. The gaps are S2, S3, S5, S7 and S10. The upgrade must therefore:

1. Derive the stage card, highlight, board frame, tables, explanation and progress from `ClassicStep` only (contract rule).
2. Make the board phase a function of the step: reset `view` to `play` whenever the step key changes, or move the phase into the step.
3. Treat `picked` as a request to seek: a click on a flow box should select the matching stage (`FlowKind` to `Stage.clause`) or be cleared on any step or tab change.
4. Pause playback when the learner leaves the Logical tab, or make the other tabs ignore it explicitly.
5. Keep one writer for the editor highlight: the effect that reads `ClassicStep.range` and `tab`.

## 7. How this was checked

- Source: `git show`, `git diff`, `git log` against `9be309e^`, `9be309e`, `4e4acb9`, `0db0b58` (section 3); a read of all classic and Cinema files named in section 6.
- Browser: Chrome (system channel), dev server `npx vite --config vite.site.config.ts --port 5185 --strictPort`, 1440 x 900, real PGlite. The B1, B2, B3, B5 and reduced-motion results were captured on the recovered host before Agent 3's rewrite was loaded. A later run on the changing tree showed the new host (teaching text, "Reset", "Explain visually") and confirmed B3 there too: the first step still says the FROM rows "could not be computed (current transaction is aborted ...)". Mobile, Firefox and WebKit were not run. The dev server was stopped afterwards.
- B4: a Node script (`vite-node`) importing `lib/sqlRunner.execute` and PGlite, three overlapping calls, one failing. Result in the table.
- Not verified: the flow-diagram click (B7) in a browser; the `traceRows` rejection path (B6).

## 8. Required patches and owners

I edit only this document and `src/test/siteClassicArchitecture.test.ts`. The patches below are for the named owner.

| # | Patch | Owner | Why |
| --- | --- | --- | --- |
| P1 | Do not run `EXPLAIN` concurrently with `visualize()`: await `visualize()` first, or pass the host's `run` through a small promise queue so queries are issued one at a time. Keep the learner's query running exactly once. | Agent 3 (`VizViewClassic.tsx`) | B3, B4: removes the "transaction is aborted" message in the host. |
| P2 | Serialise `BEGIN ... ROLLBACK` per dataset inside `runRaw` or `runQuery` (one promise chain per dataset). This also protects any other overlapping caller (the editor run, the guide, the Cinema). | Coordinator (`lib/sqlRunner.ts` or `lib/browserDb.ts`, read-only for the agents) | B4: the root cause. |
| P3 | Show the learner's real error where the learner will see it: open on, or lead with, the stage "Your query has an error" (message, "Parsed" badge dropped, no fake FROM explanation), and give that stage a teach card that says so. | Agent 3 (host) and Agent 2 (`teach.ts`: a card for the error stage) | B3. |
| P4 | Reset the board's `view` to `play` when `stageIndex` or `clause` changes (or take the phase from `ClassicStep`). Remove the internal `baseFrame` fallback so the board draws `frame` only. | Agent 4 (`RowFlowClassic.tsx`) | B1, S7. |
| P5 | Pause playback when `tab` leaves `logical`; clear `picked` on step or tab change, or map a flow-box click to `pb.dispatch({ type: "seek", index })` for the matching stage. | Agent 3 (host) | B2, B7, S2, S3. |
| P6 | Keyboard: listen on the visualizer root (Space, arrows, Home, End) with the same ignore list as the Cinema (SELECT, TEXTAREA, text INPUT, Space on a button). `ClassicPlayer` keeps the bar handler. | Agent 4 (`ClassicPlayer.tsx`) with a root handler from Agent 3 | B5. |
| P7 | Track a "trace failed" state so `refining` ends when `traceRows` rejects, and pass it to the board. Add an optional `refining` default to `RowFlowClassic` if not there. | Agent 3 (host) and Agent 4 (optional prop) | B6. |
| P8 | Correct the comment in `workspace/visualizers/sql/ClassicSqlVisualizer.tsx`: it renders the Cinema, not the original. Do not change the import. | Coordinator | `4e4acb9` wording. |
| P9 | Teach cards and tables must use only `stage` and `trace` data; where a number is a sample, the card says so (the board already does). | Agent 2 | Contract rule 1. |

Things other agents must not do (the test enforces them): import any Cinema module from the classic layer; import the classic layer from any page except `QuestionPage`; add a PGlite, Pyodide, worker or runner import under the classic paths; call `runQuery` from any classic file except the host; add a second `usePlayback` or a `setInterval` playback; put DOM or React code in `lib/visual/classic`; style a bare element in `classic-*.css`.

## 9. The guardrail test

`frontend/src/test/siteClassicArchitecture.test.ts` (vitest, node environment, source text only). It walks `components/visual/classic/**`, `lib/visual/classic/**`, `VizViewClassic*`, `RowFlowClassic*`, `Classic*` components and `classic-*.css`, so files added by other agents are covered without editing the test. It checks:

1. No classic file imports `VizView`, `QueryCinema`, `cinema.ts`, `aggDetail.ts`, the Cinema's `HighlightedSql`, or the non-classic `RowFlow`, `rowFlow`, `rowTrace`; no Cinema class name or test id appears in classic code or CSS; classic CSS has no bare element selector.
2. No engine, worker or runner import under the classic paths; only the host imports `lib/browserDb`; `lib/visual/classic` is pure; one `usePlayback` call; no `setInterval`.
3. `QuestionPage` imports and renders `VizViewClassic` and nothing from the Cinema; the host keeps `sql`, `dataset`, `onDone`, `onClause`, `VizSummary`; the host uses `runQuery`, `visualize`, the classic `traceRows`, `usePlayback`, `useClassicStep`; `ClassicStep` keeps its fields.
4. `QueryVisualizerPage`, `ScenarioPages` and `ClassicSqlVisualizer` still import `VizView` and not the classic layer; the Cinema files exist.
5. Only the classic layer and `QuestionPage` import classic modules; no Python, Pandas or NumPy visualizer file does.
6. This document exists and names the evidence (`9be309e`, `cb29eff`, `0db0b58`, `4e4acb9`, `ClassicStep`, `useClassicStep`).
