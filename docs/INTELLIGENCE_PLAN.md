# Intelligence, data engineering & career: gap analysis and plan

This document checks the "Advanced Intelligence, Data Engineering & Career Development" specification against the repository as of 2026-11-04. Earlier rounds are in [LEARNING_PLATFORM_PLAN.md](LEARNING_PLATFORM_PLAN.md), and the content formats are in [CONTENT_SPEC.md](CONTENT_SPEC.md).

## Architecture constraints that shape every feature

- **Public site** (`frontend/src/site/`): a static site on Cloudflare. SQL runs in **PGlite** (PostgreSQL 18.6, WASM) in a Web Worker, and every query is wrapped in `BEGIN … ROLLBACK` with a timeout. Progress is kept in localStorage and optionally synced to Supabase. There is no server of our own.
- **Local app** (`frontend/src/` with `backend/` FastAPI): the full Postgres stack, a read-only role, project databases (`sqlp_<slug>`) and the ChatGPT import.
- **Paid services:** none have been added. The AI tutor ships **without a provider**; see "AI provider options" below.

## Gap analysis

| Spec area | Before this round | Status now |
|---|---|---|
| 3. AI SQL mentor `/ai-tutor` | 3-level hint ladder and error coach only | **Done, except AI chat (disabled by design).**<br>• Provider abstraction (`lib/tutor.ts`: `TutorProvider`, `disabledProvider`, `httpProvider`); no keys in the frontend.<br>• Context limited to the question, the real schema of its tables, the user's SQL, attempts, hint level, mistakes and related notes.<br>• Deterministic schema check (flags non-existent tables or columns).<br>• Clause-by-clause explanation.<br>• "Check my result", verified by the DB without recording a submit.<br>• 5-level assistance, every level recorded; a solve after level ≥ 2 or a reveal is marked **assisted**.<br>• Tutor settings: highest level allowed, confirm before the solution.<br>• Links to the visualizer and comparison tools.<br>The chat tab shows a disabled state until `VITE_TUTOR_ENDPOINT` is set. |
| 4. Query visualizer `/query-visualizer` | Missing (only the EXPLAIN tree in the editor) | **Done.**<br>• Logical-order stepper: FROM/JOIN → WHERE → GROUP BY → HAVING → window → SELECT → DISTINCT → ORDER BY → LIMIT.<br>• Real intermediate rows (capped at 20) and exact counts from derived queries.<br>• JOIN cards: left and right rows, matching pairs, unmatched rows with samples.<br>• Rows removed by WHERE and HAVING, with partition sizes for window functions.<br>• Clause highlighting, back and next.<br>• A separate **physical plan** tab.<br>Unsupported shapes (set operations, multiple statements, non-SELECT) are reported rather than guessed. |
| 5. Solution comparison `/solution-comparison` | Missing | **Done.** Side-by-side editors showing:<br>• equivalence (ordered or unordered) and a row diff<br>• detected approaches and structural complexity<br>• median of 5 timed runs after a warm-up, with the per-run times<br>• plan cost and plan tree<br>• rule-based notes on NULL, duplicate and determinism traps<br>• recorded conditions: engine version, row count and indexes per table<br>It never declares a winner. |
| 6. Readiness `/readiness` | Weak-topic scoring (`lib/insights.ts`) | **Done.**<br>• Each topic is scored on five dimensions: application, independence, efficiency, knowledge and retention.<br>• A topic needs at least 3 practiced questions, and an overall estimate needs at least 3 assessed topics.<br>• Repo or imported solves are shown but **never scored**, and assisted solves never count as independent.<br>• Shows recommendations, revision and the next check date, labelled as an estimate. |
| 7. Multi-database playground | Northwind only (public); project DBs in the local app | **Done (Phase 2).**<br>• Northwind plus HR, Sales, E-commerce, Banking and Inventory (`scripts/build_datasets.py`, deterministic), plus your own generated datasets.<br>• **Each dataset runs in its own PGlite worker**, so a query can't see another database.<br>• Schema explorer reads keys from the live catalog, with row counts, a table preview and an ER diagram.<br>• Per-dataset history and saved queries.<br>• CSV/JSON export and a reset (a fresh instance).<br>Local-app project databases are unchanged. |
| 8–9. Data engineering hub, projects lab | Missing | Phase 3 (reuse the notes, mind map and content infrastructure) |
| 10. Scenario simulator | Partial: lessons, interview sets | **Done (Phase 2).**<br>• 16 business scenarios across the six datasets (`content/scenarios/*.md`).<br>• Each has context, requirement, success criteria with exact output columns, a reference and ≥ 1 alternative solution.<br>• Graded by result, so any correct query passes; every alternative is tested to grade correct.<br>• The explanation, alternatives and follow-ups unlock after solving. |
| 11. Data generator | Missing (the local app has dataset upload) | **Done (Phase 2).** `/data-generator`:<br>• Tables and columns (13 kinds), PKs and FKs.<br>• NULL, invalid and orphan percentages, and duplicate rows; clean, realistic and messy presets.<br>• A seeded RNG, so the same settings always give the same data.<br>• Validation, preview, ER diagram, SQL/CSV export, and opening the dataset in the playground (stored in this browser, isolated instance). |
| 12. Data quality lab | Missing | Phase 3 |
| 13. Company prep | Partial: role-based interview sets | Phase 4 (verified / user-contributed / AI-generated labels are needed) |
| 14. Answer practice | Missing | Phase 4 (needs an AI provider for scoring; a rubric self-check is possible without one) |
| 15. Planner | Partial: daily goal, review queue | Phase 4 |
| 16. Portfolio | Partial: public profile (Supabase) | Phase 4 |
| 17. Platform maturity | Offline (service worker) ✓, global search ✓, community ✓ (Supabase), admin ✓ (users/audit/moderation), export/import of progress ✓ | Remaining: version history, custom paths, achievements, content CMS, public API |

## Evidence model (new fields, `QuestionProgress`)

| Field | Meaning |
|---|---|
| `practiced` | At least one real submit in the editor. The only kind of evidence readiness uses. |
| `imported` | The row came from the account or repo and has no local practice. It is displayed but not scored. |
| `hintLevel` | The highest assistance level opened (1–5). The full solution counts as 5. |
| `assisted` | The first solve happened after `hintLevel ≥ 2` or a revealed solution. |
| `startedAt` / `solveSec` | The first interaction, and the time to the first solve. |
| `errorKinds` | Counts of deterministic error classes on failed submits (from `lib/errorHelp.ts`, otherwise "Wrong result" or "SQL error"). |

Signed-in users sync these fields through `profiles.state.qmeta`, so no migration is needed. "Check my result" never records an attempt.

## AI provider options (not connected)

| Option | Where the key lives | Cost | Notes |
|---|---|---|---|
| Cloudflare Worker proxy and a hosted model API (e.g. Claude) | Worker secret | Paid per token | Works on the public site. Needs rate limiting per visitor. |
| Local FastAPI endpoint | `backend/.env` | Paid per token, or free with a local model | The local app only. |
| Local open-weights model (e.g. via Ollama) behind FastAPI | None | Free; needs a capable machine | Lower quality. The local app only. |

To enable one, deploy an endpoint that accepts `{context, messages}` and returns `{reply}`, then build with `VITE_TUTOR_ENDPOINT=<url>`. The endpoint must:
- treat `context` as data, never as instructions
- cap tokens per request and rate-limit per user
- never execute SQL itself; correctness stays with "Check my result"

## Tests added

- `siteClauses.test.ts`: clause splitting, unsupported shapes, approach detection.
- `siteVisualize.test.ts`: stage counts on real Northwind, JOIN unmatched rows, windows, DISTINCT, comparison equivalence, row diff, lint.
- `siteTutor.test.ts`: disabled provider, schema check, explanation order, context contents.
- `siteReadiness.test.ts`: evidence thresholds, imported vs practiced, independent vs assisted, tracking.

## Phase 2 additions to evaluation

- `diagnose()` in `lib/resultCompare.ts` explains a wrong result from the two result sets:
  - wrong column order, or a column that needs renaming
  - duplicate rows (join fan-out)
  - extra rows (a filter is too loose)
  - missing rows (a filter is too strict, or an INNER JOIN drops unmatched rows)
  - rounding-only differences
  - NULL vs 0
- These run on every submit, before the generic checklist.

## Next phases

1. ~~Phase 2, practical SQL environment.~~ Shipped (see above).
   Original plan:
   - Multi-database playground: ship extra datasets (HR, sales, e-commerce, banking, inventory) as SQL files loaded into separate PGlite instances, with query history and saved queries.
   - Data generator: client-side and exportable.
   - Scenario simulator: reuse lesson exercises and result grading.
2. **Phase 3, data engineering.** Tracks as `content/tracks/<track>/*.md` using the notes renderer, plus a projects lab (validation through PGlite for SQL steps, with a checklist for steps outside the browser) and a data quality lab built on the generator.
3. **Phase 4, career.** Company prep with provenance labels, answer practice (rubric now, AI scoring once a provider exists), a planner on top of readiness, and a portfolio from verified activity only.
4. **Phase 5, maturity.** Version history of attempts, achievements tied to independent evidence, a content CMS for admins, and a rate-limited public API.
