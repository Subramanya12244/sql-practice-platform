# SQL safety and question integrity (Phase 2, Agent 1)

Owner: Phase 2 Agent 1 (SQL correctness and execution safety). Code: `frontend/src/site/workspace/adapters/sql/{policy,lexer,safety,adapter,backend}.ts`, `frontend/src/site/lib/sqlRunner.ts` (additive). Contract: `SqlPolicy` and `ExerciseDef.sqlPolicy` in `workspace/types.ts`. Tests: `siteWorkspaceSqlSafetyPolicy`, `siteWorkspaceSqlSafetyDb`, `siteSqlQuestionIntegrity`.

Everything in this file was run. Where something is a limit or was not tested, it says so.

## 1. What changed, in one paragraph

Graded SQL exercises used to be guarded by a text scanner (mask comments and strings, split on `;`, regex on the first keyword) with `SET TRANSACTION READ ONLY` as the real backstop. The boundary is now a parser-based policy (`pgsql-ast-parser`, with a PostgreSQL-faithful tokenizer under it) that classifies every statement before anything reaches the database. It is enforced twice: in the adapter (`run` and `validate`) and in the shared runner `lib/sqlRunner.ts` (`execute`, `submit` and `runRaw` take an optional `policy`). For read-only exercises PostgreSQL's own `READ ONLY` transaction stays as the database-level second layer. Separately, Q19 was graded against the wrong query; it and six other references are patched (section 9).

## 2. The three policies

`SqlPolicy = "read-only" | "own-tables" | "own-data"` (contract in `types.ts`). `readOnly: true` stays as an alias of `read-only`.

| Statement | read-only | own-tables | own-data |
| --- | --- | --- | --- |
| SELECT, WITH ... SELECT, VALUES, TABLE, SHOW | yes | yes | yes |
| EXPLAIN [ANALYZE] of an allowed statement (judged as the inner statement) | yes | yes | yes |
| `SET TRANSACTION READ ONLY` (only narrows) | yes | yes | yes |
| CREATE [TEMP] TABLE, CREATE TABLE AS, CREATE [MATERIALIZED] VIEW | no | yes | yes |
| CREATE INDEX | no | on a table the script created | same |
| INSERT | no | into a table the script created | same |
| REFRESH MATERIALIZED VIEW | no | of a view the script created | same |
| UPDATE, DELETE | no | no | on a table the script created |
| DROP, TRUNCATE, ALTER | no | no | no (see grants, section 4) |
| Data-changing CTE (`WITH x AS (DELETE ... RETURNING ...)`) | no | each inner statement is judged like a statement of its own | same |
| SELECT ... INTO, SELECT ... FOR UPDATE/SHARE | no | no | no |
| Side-effect functions (section 6) | no | no | no |
| BEGIN, COMMIT, ROLLBACK, SAVEPOINT, START, END (transaction control) | no | no | no |
| COPY, CALL, DO, MERGE, LOCK, VACUUM, ANALYZE, REINDEX, CLUSTER, LISTEN, NOTIFY, PREPARE, DISCARD | no | no | no |
| GRANT, REVOKE, CREATE/ALTER ROLE, CREATE EXTENSION, CREATE SCHEMA/SEQUENCE/TYPE/TRIGGER | no | no | no |
| CREATE FUNCTION | no | only by a grant (section 4), LANGUAGE sql, body must be a plain query | same |
| SET / RESET of session settings | no | only by a grant (section 4) | same |
| Any object outside `public` / `pg_temp` (for example `pg_catalog`) | no | no | no |

Rules for "created by the same script":

- Names are tracked in order. `INSERT INTO s` before `CREATE TABLE s` is refused.
- Names fold like PostgreSQL: unquoted to lower case, quoted keeps its case. `CREATE TABLE Foo` then `INSERT INTO foo` is fine; `CREATE TABLE "Foo"` then `INSERT INTO foo` is refused (a different table). `public.foo` is `foo`; any other schema is a different name.
- `CREATE TABLE IF NOT EXISTS customers` is refused (it would silently target the base table); the dataset's table names (Northwind's, plus `ExerciseDef.dataset.tables`) are protected that way.
- Base tables are never "created by the script", so they can never be written to by the strict rules.

## 3. How the policy of an exercise is derived

If `ExerciseDef.sqlPolicy` is absent (or `readOnly: true`), the adapter derives it from the exercise's reference query (`validation.expectedSql`) with `derivePolicy`:

1. Read the reference (parser first, token tier if the parser cannot read it).
2. Evaluate it under the strictest rules while collecting what it needs:
   - only queries: `read-only`;
   - CREATE / INSERT / REFRESH of its own objects: `own-tables`;
   - UPDATE or DELETE of tables it created itself: `own-data`.
3. Anything the reference itself does that the strict rules would refuse becomes an exact grant (section 4); a grant lifts the level to at least `own-tables`, because a read-only transaction would stop the lesson's own statement.

An explicit level wins over the derived one. An explicit `read-only` carries no grants. Ungraded exercises (`validation.kind` is `none`) have no policy unless they declare one (everything is still rolled back, as before).

Counts (all 150 questions through `sqlQuestionToExercise`, all 387 Daily SQL exercises through `dailyExerciseToExercise`; the numbers are asserted in `siteWorkspaceSqlSafetyPolicy.test.ts`):

| Set | read-only | own-tables | own-data | refused by own derived policy |
| --- | --- | --- | --- | --- |
| 150 SQL questions | 142 | 8 (Q184 to Q191, the DML and DDL questions) | 0 | **0** |
| 387 Daily SQL exercises | 264 | 112 | 11 | **0** |

How the references were read: questions 143 parsed and 7 by the token tier (Q150, Q151, Q153, Q156, Q197, Q199, Q204); Daily 297 parsed and 90 by the token tier. None was unreadable. A second test also runs every question's `mySolution` (the learner's own recorded attempt) through the policy derived for that question: none is refused.

## 4. Grants: where the real exercises are wider than the brief

The brief says own-tables never writes to base tables and never DROPs, TRUNCATEs, ALTERs or creates functions. The corpus does all of that on purpose, in rolled-back lessons:

- Questions Q184 to Q191 INSERT, UPDATE, DELETE and ALTER the Northwind tables `shippers`, `products`, `customers`, `order_details`, with data-changing CTEs.
- Daily exercises: `d044#g1..i3` insert, update and delete base tables; `d057/d058/d059` `CREATE INDEX` on `orders`/`products` and `SET LOCAL enable_seqscan = off`; six drop their own scratch table first (`DROP TABLE IF EXISTS`); `e124#g3` TRUNCATEs, `e135#i1` and `e149#g4` ALTER their own tables; `a165#i2` creates an SQL function.

A policy that refused those would refuse the exercise's own reference, which the task forbids. So the derived policy carries **exact grants taken from the reference**, as strings:

`write:<insert|update|delete>:<table>`, `ddl:<drop|truncate|alter>:<table>`, `index:<table>`, `set:<variable>`, `function:<name>`, `refresh:<view>`.

A learner may do exactly the (verb, table) pairs the reference does and nothing else of that kind. Example: a reference with `DELETE FROM order_details WHERE quantity = 1` allows any `DELETE FROM order_details` and still refuses `DELETE FROM orders`, `UPDATE order_details` and `DROP TABLE order_details` (tests: "grants taken from the reference"). A `CREATE FUNCTION` grant needs `LANGUAGE sql` and a body that passes the read-only policy. This is a documented deviation from "no writes to a dataset base table": it applies only to the 8 questions and about 20 Daily exercises whose own answer does it, and the change is always rolled back.

## 5. Where it is enforced

| Point | What | Code |
| --- | --- | --- |
| 1. adapter `run` | policy check before `backend.run`; refusal is a `RunOutcome` with `error.type` `READ_ONLY` (read-only) or `SQL_POLICY`, no database call | `adapter.ts` |
| 1. adapter `validate` | same check; a refusal is a failed test ("Read-only: only a SELECT is allowed" or "Only the statements this exercise allows"), category `read-only`, the grader is not called | `adapter.ts` |
| 2. shared runner | `execute(db, sql, { policy })`, `submit(db, sql, ref, sortRequired, orderBy, hidden, { policy })`, `runRaw(db, sql, { policy, setup })`. The check is the first thing that happens, before the sequence snapshot and before `BEGIN`; a refusal is `ExecuteResult.error_type` `READ_ONLY`/`SQL_POLICY` or a failed `SubmitResult` ("This statement is not allowed in this exercise."). Default behaviour (no `policy`) is byte-for-byte what it was: the Playground and every other caller are unchanged | `lib/sqlRunner.ts` |
| 2. app backend | `browserBackend.run/submit` with a policy go through the same `execute`/`submit` on the app's existing PGlite worker handle, with the same 8 s limit; without a policy they call `runQuery`/`submitQuery` as before | `backend.ts` |
| 3. database layer | a `read-only` policy opens the transaction `READ ONLY`: the runner issues `SET TRANSACTION READ ONLY` inside `BEGIN`, and the adapter still prefixes it too (so a backend that ignores `policy` is still protected, and the error-position shift is unchanged). For `submit`, the hidden test rows are trusted setup that runs first, then the transaction is narrowed | `lib/sqlRunner.ts`, `adapter.ts` |
| 4. rollback | every run is `BEGIN ... ROLLBACK`; sequences are snapshotted and restored; unchanged | `lib/sqlRunner.ts` |

`own-tables` and `own-data` have no database-level read-only layer (they must write), so for them the parsed policy and the rollback are the layers. See "Known limits".

## 6. How a script is read

1. **Tokenizer** (`lexer.ts`). Nested `/* */`, `--`, `'...'` (`''`), `E'...'` (backslash escapes), `U&'...'`, `B/X/N'...'`, `$$` and `$tag$` quotes, `"..."` identifiers, PostgreSQL's six whitespace characters. A backslash does not escape in a standard string (`'a\'; DROP TABLE t; --'` is a string followed by code, as in PostgreSQL). Refused outright: an unterminated string, comment or quote, a NUL character, a stray `$`, an input longer than 100,000 characters, and invisible or look-alike Unicode characters outside quotes (no-break space, em space, ideographic space, zero-width and bidi characters, BOM), because PostgreSQL treats them as identifier characters and other readers as whitespace.
2. **Statements** are split at top-level `;`. Every statement is judged; `EXPLAIN [ANALYZE] [(options)]` is removed first and its inner statement is judged as if it were run (EXPLAIN ANALYZE runs it).
3. **Parsed tier (the boundary).** The statement text, with comments removed and string contents replaced by `'x'` (so `$$`, `E''` and quoting tricks cannot confuse the parser), is parsed by `pgsql-ast-parser`. Facts come from the AST: statement type, target tables (unquoted names are already folded by the parser), every function call anywhere in the tree, nested data-changing statements, `FOR UPDATE/SHARE`. `CREATE TABLE ... AS` is read as its token head plus the parsed query; `CREATE FUNCTION` is read from tokens (it needs an exact grant and its body is checked as a read-only script).
   Cross-checks that fail closed: each statement must parse to exactly one AST node; the verb the AST sees must equal the verb the token reader sees; when the script contains no EXPLAIN, CTAS or function, the whole script is parsed again and must give the same statement count.
4. **Rule engine** (`evaluate`). One engine over the facts judges both tiers, so every rule is written once.
5. **Unparseable SQL.** Refused with "This statement could not be checked for safety (<parser message>). ... rewrite it with standard syntax", **except**:
   - `read-only` exercises: read by the token tier (same rules, plus every bare data-changing or DDL keyword such as INSERT, UPDATE, DELETE, DROP, ALTER, CREATE, COPY, CALL, DO, BEGIN refused anywhere in a query) and then run in PostgreSQL's `READ ONLY` transaction. Reason: a typo is by far the most common unparseable input, and refusing it would replace PostgreSQL's own message and line number ("syntax error at or near ...") with a parser message; the existing adapter tests pin the PostgreSQL experience. Nothing that can write passes both independent layers.
   - exercises whose own reference the parser cannot read (`spec.lexical`, 7 questions and 90 Daily exercises): the token tier with the same rules, for every level. Without this their own reference would be refused.
   This is a deliberate softening of "refuse everything unparseable". It is one condition in `checkSqlPolicy` (`spec.lexical || spec.level === "read-only"`) if the coordinator wants it stricter, at the price of the typo-message loss above.

Side-effect functions refused wherever they appear (any schema, any case, quoted or not): `nextval`, `setval`, `set_config`, `pg_sleep`, `pg_sleep_for`, `pg_sleep_until`, `pg_notify`, `pg_terminate_backend`, `pg_cancel_backend`, `pg_reload_conf`, `pg_rotate_logfile`, `pg_stat_file`, `pg_switch_wal`, `pg_promote`, `query_to_xml`, `query_to_xmlschema`, `query_to_xml_and_xmlschema`, `cursor_to_xml`, `cursor_to_xmlschema` (these run SQL passed as a string), `lowrite`, `loread`, `lo_*`, and the families `dblink*`, `pg_advisory_*` (session locks outlive ROLLBACK), `pg_read_*`, `pg_ls_*`, `pg_file_*`, `pg_stat_reset*`, `pg_replication_*`, `pg_logical_*`, `pg_create_*`, `pg_backup_*`. `pg_sleep` is refused because it only stalls the single worker (the 8 s limit then tears it down); this changed one existing test, see section 8.

## 7. What is NOT blocked, and why

- **Text that looks dangerous but is only text** (`SELECT 'DROP TABLE t'`, `$$; DROP TABLE t; $$`, `E'a\'; DROP'`, comments, quoted identifiers named `"select"` or `"DROP"`): runs. It is data, not code (tested: runs, nothing changes).
- **User-defined functions with side effects** (for example one a script defined itself, or one in the dataset): the policy cannot see inside them. In a `read-only` exercise PostgreSQL's `READ ONLY` transaction stops them (tested with a real `UPDATE`-ing function: "cannot execute UPDATE in a read-only transaction", table unchanged). In `own-tables`/`own-data` they would run, rolled back, and creating functions needs a grant anyway.
- **Resource use**: `generate_series(1, 10^9)`, huge cross joins, deep recursion. Not refused; the app's 8 s limit tears the worker down and starts a fresh one. A runaway query cannot be cancelled inside wasm.
- **Reads of catalogs and settings** (`pg_catalog`, `information_schema`, `current_setting`, `SHOW`): allowed; they change nothing.
- **Planner hints through a grant** (`SET LOCAL enable_seqscan`): only the exact variables a reference sets.
- **The ungraded exercises and the Playground**: no policy (rolled back, transaction control refused, as before). Graded exercises only.

## 8. Existing tests: what was kept and what changed

`siteWorkspaceSqlAdapter.test.ts` (62 tests) passes unchanged except one assertion setup, edited because it encoded behaviour the brief reverses:

- "performance: a timeout, with a cross join named only when it is in the SQL" used `pg_sleep(0.6)` in a **graded** exercise. `pg_sleep` is now refused in graded exercises (the brief lists it), so the exercise is now declared ungraded (`exercise(null)`); the test still exercises a real timeout and the same explanation.

The text scanner internals are gone: `safety.ts` keeps `checkReadOnly` (same return shape, now the token tier of the policy, used by the visualizer's `isSingleQuery`), `isSingleQuery` and `READ_ONLY_PREFIX`. The adapter's old `readOnly` option is still honoured. All the `checkReadOnly` assertions in the old test pass as written.

## 9. Question integrity audit

### 9.1 Q19

- **Symptom.** `frontend/public/data/q/q19-customers-above-average-revenue-using-cte.json` had `solution` and `referenceQuery` equal to Q197's recursive employee chain (`employee_id, first_name, last_name, depth, path`, 9 rows) and `orderBy: [{"column": "path"}]`, which is Q197's. Its title, problem, objective, tables (`customers, orders, order_details`), expected-output columns (`customer_id, company_name, total_revenue`) and `mySolution` (two CTEs, customers above the average revenue) are the customers query. A correct answer failed with "Check your column names and column order"; the 30-row correct result could never match 9 employee rows.
- **Root cause (found in the source repo, which exists as a sibling checkout `../northwind-sql-practice`, read only).** `backend/app/services/repo_parser.py` `find_sql_for_md` looks up `Q{n:02d}*.sql` with a prefix glob and takes `candidates[0]`. For n = 19 the glob `Q19*` matches `Q19_Customers_Above_Average_Revenue_CTE.sql` **and** `Q197_Employee_Reporting_Chain_With_A_Recursive_CTE.sql` in the same folder (`05_CTE`), and the second comes first. `scripts/build_public_data.py` writes that file's SQL into `solution` and `referenceQuery` and derives `sortRequired`/`orderBy` from it. I ran `find_sql_for_md` over all 150 source `.md` files: **Q19 is the only one whose SQL file number differs**. (Python glob order is filesystem order, so the same bug can bite other numbers on another machine: Q14/Q147..Q149, Q15/Q150..Q159 and so on, whenever both files share a folder.) The source `.sql` of Q19 itself is correct.
- **Derived correct query.** The question's own `mySolution` and the source `Q19_...sql`: two CTEs (`customer_revenue` = per-customer `SUM(unit_price * quantity * (1 - discount))`, `overall_avg` = `AVG(total_revenue)`), comma-joined, `WHERE total_revenue > avg_revenue ORDER BY total_revenue DESC`. Checked on real PGlite: columns `customer_id, company_name, total_revenue`; 30 rows; every revenue above the computed average; descending; **the same 30 customers as Q6**, which the problem says it restates.
- **Patch** (hand patch of the one JSON, fields proven wrong only): `solution` and `referenceQuery` set to `mySolution`; `orderBy` set to `[{"column": "total_revenue", "desc": true}]` (what `outer_order_by` computes for that query); `sortRequired` was already `true` and is correct. Everything else in the file, and the 149 other files, is byte-identical (`json.dumps(..., ensure_ascii=False)` reproduces the original bytes, so the diff is one line per file).
- **Before / after.** Before: reference = employee chain, 9 rows; the correct answer was marked wrong (column mismatch). After: reference = customers query; the reference, `mySolution` and a differently written correct answer (HAVING with a scalar subquery) pass; Q197's query, the same query with revenue computed without the discount, the right rows in ascending order, and `SELECT 1` all fail (test `Q19`, 9 tests).

### 9.2 The 23 questions whose `solution` differs from `mySolution`

`mySolution` is the learner's recorded attempt (often an early or wrong one); `solution` is the graded reference. Each pair was run on PGlite and compared with the title, problem, objective and output table.

| Q | Title | Verdict |
| --- | --- | --- |
| 19 | Customers Above Average Revenue Using CTE | **fixed**: Q197's query (section 9.1) |
| 40 | Customers and Average Order Value | ok: averages per-order totals (AOV); mySolution averages order lines, unnamed column |
| 42 | Products and Suppliers | ok: formatting only |
| 49 | Customers and Average Order Value (RIGHT JOIN) | ok: keeps all 91 customers with 0; mySolution drops the 2 without orders |
| 57 | Employees and Total Revenue | ok: `\|\|` gives a NULL name for the unassigned-orders row as the problem says; CONCAT gives a blank |
| 58 | Customer Revenue Comparison (Advanced) | ok: trailing comments only |
| 61 | Employees Without a Manager | ok: anti-join and `reports_to IS NULL` give the same one row |
| 62 | Employees Who Are Managers | **fixed**: returned 3 rows with a blank name (the NULL-manager group had `COUNT(e.employee_id) > 0`); now `COUNT(e.reports_to) > 0`: Fuller and Buchanan, equal to an `EXISTS` check |
| 63 | Employees Reporting to the Same Manager | ok: mySolution printed the employee as manager |
| 64 | Employees Having the Same Job Title | ok: same 15 pairs, mySolution has a redundant join |
| 67 | Customers from the Same City | ok: mySolution returned country |
| 68 | Products with the Same Supplier | ok: mySolution was a Cartesian product |
| 69 | Products in the Same Category | ok: mySolution was a Cartesian product |
| 71 | Employee-Category Combinations | ok: CROSS JOIN, 72 rows; mySolution does not compile |
| 73 | Supplier-Category Combinations | ok: supplier name is `company_name` |
| 78 | Supplier-Shipper Combinations | ok: same |
| 82 | Contact Directory with Type Label | ok: label `'Employee'` as the problem says, ordered |
| 83 | Master Contact Directory | ok: same |
| 84 | Master Company Directory | ok: columns `Company_Name, Country, Entity_Type` as listed |
| 86 | Entity Record Count Summary | ok: `Total_Records` as listed |
| 92 | Countries with More Customers Than Employees and Suppliers | ok: required aliases and ORDER BY |
| 96 | Countries with the Highest Customer Count Above the Overall Average | ok on spacing; columns fixed below |
| 97 | Countries with More Customers Than Their Entity Average | ok on spacing; columns fixed below |

### 9.3 Other proven mismatches, outside that list of 23

The test that compares every reference's columns with the problem's output table (the grader compares names and order) found five more where a learner who follows the problem can never pass. `solution` and `referenceQuery` were patched (logic kept, names and order fixed; `mySolution` and all prose untouched):

| Q | Was | Now |
| --- | --- | --- |
| 32 | unnamed `count` | `AS distinct_products` |
| 33 | unnamed `coalesce`; counted **all** orders although the problem, `watchOutFor` and `takeaway` say shipped (13 of 91 customers differ on this data: 100 orders, 85 with a `shipped_date`) | `shipped_orders`, and `o.shipped_date IS NOT NULL` in the `ON` clause, as the question's own takeaway prescribes |
| 36 | `company_name` | `AS supplier_name` |
| 96 | `total_cust, avg_count, max_count` (four columns for a three-column table) | `total_customers, average_customers` |
| 97 | `total_employee, total_customers, total_suppliers` | `total_employees, total_suppliers, total_customers` |

Q33 is the one judgment call (it changes which rows are counted, not only names). Revert it by restoring `solution`/`referenceQuery` from git if the owner prefers the old reading. Q70's output table lists `contact_name (c1)` and `contact_name (c2)`, which cannot be SQL names; its reference returns `contact_name` twice and is left as is (listed exception in the test).

Not changed, noticed: Q40 and Q49 differ by 0.01 on two customers (one rounds each order total first), both defensible; Q199 sorts by `rev`, an inner column that is not in its output, so the grader falls back to strict row order (stricter, not wrong).

### 9.4 Test (`siteSqlQuestionIntegrity.test.ts`, 23 tests)

All 150 files load; every reference runs on PGlite; every reference's columns equal the problem's table (except Q70, listed); no two questions share a reference query (Q19/Q197 was the only pair, no exceptions remain); `orderBy` keys are output columns (Q199 listed); the set of questions whose `solution` differs from `mySolution` is exactly the audited set, so a new difference must be judged; the 9 Q19 cases above; Q62, Q33, Q40/Q49, Q57 checks.

### 9.5 What to do in the source repo so regeneration does not reintroduce this

`public/data/q/**` is generated; a regeneration with the current generator overwrites these patches and brings Q19's bug back.

1. `backend/app/services/repo_parser.py` `find_sql_for_md`: match the question number exactly. Replace the two globs and the fallback with something like `[p for p in parent.glob("*.sql") if (m := re.match(r"Q0*(\d+)(?!\d)", p.name)) and int(m.group(1)) == qnum]`, and raise if there is more than one candidate.
2. `scripts/build_public_data.py`: after `find_sql_for_md`, assert `question number of sql_path == number` and that no two questions share a `referenceQuery` (this repo's `siteSqlQuestionIntegrity.test.ts` checks the output too).
3. In `northwind-sql-practice`, fix the references of Q62 (use `COUNT(e.reports_to) > 0`), Q32 (`AS distinct_products`), Q33 (`ON ... AND o.shipped_date IS NOT NULL`, `AS shipped_orders`), Q36 (`AS supplier_name`), Q96 and Q97 (output columns as the Output format section lists). Q19 needs no source change.
4. Regenerate, then run the integrity test; it fails if any of this regresses.

## 10. Known limits (honest list)

- **The parser is narrower than PostgreSQL.** `pgsql-ast-parser` 12.0.2 cannot read, among others: window frames (`ROWS BETWEEN`), a `WINDOW` clause, `WITH RECURSIVE` without a column list, `IS DISTINCT FROM`, `GROUPING SETS`, `TABLESAMPLE`, `DELETE ... USING`, chains of set operations without parentheses, `CREATE TABLE ... PARTITION OF`, `MERGE`. For exercises whose reference uses them the token tier applies (7 questions, 90 Daily exercises). A learner in an `own-tables`/`own-data` exercise whose reference the parser *can* read, who uses one of those constructs, is refused with the "could not be checked" message and a hint (this is the fail-closed price). In a `read-only` exercise they run (token tier + READ ONLY). Upgrading or replacing the parser removes this; the tier counts in the test show it.
- **Differential risk.** The policy reads the SQL with the tokenizer and the parser, not with PostgreSQL's own grammar. The cross-checks (statement count, verb agreement, whole-script re-parse, refusal of look-alike characters) make a disagreement fail closed, but a construct that all three read the same and PostgreSQL reads differently is not excluded by construction. For read-only exercises PostgreSQL's `READ ONLY` transaction is the independent answer. For `own-tables`/`own-data` there is none beyond the rollback: a misread would run inside the rolled-back transaction of the learner's own in-browser copy.
- **Rolled-back, not undone.** A `DROP`/`DELETE` that slipped through an own-* exercise would be visible to the rest of that run and rolled back after it. Sequences are restored by the runner; other session state (settings via an unlisted function, advisory locks) is not covered beyond the deny list.
- **`browserDb.runQuery/submitQuery` have no policy parameter** (file not owned by this agent). `browserBackend` therefore reproduces their 8 s limit with `getDb/resetDb/QUERY_TIMEOUT_MS` when a policy is given. It is tested against a fake `browserDb` (policy present: nothing reaches the worker for a refusal; absent: `runQuery`); **not tested against the real PGlite worker in a browser.** See the interface request below.
- **Not tested:** Firefox and WebKit; a real `PGliteWorker`; `sqlPolicy` set by an external content file (the field is only exercised through `ExerciseDef`).
- **Deny list is a list.** A new dangerous built-in not in it (or an extension function) is only stopped by READ ONLY in read-only exercises.
- **Very long input** is refused at 100,000 characters; deeply nested expressions are not limited (the parser's stack is the limit).

## 11. Tests

| File | Tests | What it proves |
| --- | --- | --- |
| `siteWorkspaceSqlSafetyPolicy.test.ts` | 164 | lexer rules; read-only allowed (29) and refused (103 inputs: DROP, TRUNCATE, DELETE, UPDATE, ALTER, CREATE, INSERT, MERGE, COPY, GRANT/REVOKE, SET/RESET, transaction control incl. behind comments, DO, CALL, LOCK, VACUUM, data-changing CTEs, EXPLAIN ANALYZE of writes, SELECT INTO, CTAS, INSERT ... SELECT, side-effect functions, comment tricks, `'a\'; DROP` string trap, mixed case, newline-only separators, look-alike whitespace, NUL, empty, very long); own-tables and own-data rules (order, quoting, schema, protected names); grants; derivation; all 150 + 387 references pass their derived policy (refused = 0) with exact per-policy and per-tier counts; token tier; denied functions |
| `siteWorkspaceSqlSafetyDb.test.ts` | 157 | real PGlite plus a spy on every `exec`: for 78 blocked inputs (read-only) and 39 more for own-tables, through `adapter.run`, `adapter.validate`, `execute`, `submit` and `runRaw`: refused, **zero exec calls**, and snapshots of table contents, table list, sequences, functions, settings, roles are identical afterwards; harmless text runs and changes nothing; PostgreSQL READ ONLY stops a user function; own-tables and own-data behaviour and rollback; Playground default unchanged; grading parity with and without a policy over all 150 questions and all 387 Daily exercises (same `correct` and message); representative DML, index, SET, function, materialized-view exercises through the adapter; hidden rows plus READ ONLY ordering; `browserBackend` routing |
| `siteSqlQuestionIntegrity.test.ts` | 23 | section 9.4 |
| `siteWorkspaceSqlAdapter.test.ts` (existing, one setup edited) | 62 | unchanged behaviour |

Commands (from `frontend/`, `V=/Users/subramanyaacharya/Downloads/project/sql-practice-platform-integration/.venv-daily`):

```
PATH=$V/bin:$PATH DAILY_PYTHON=$V/bin/python TZ=UTC npx vitest run src/test/siteWorkspaceSql src/test/siteSqlQuestion src/test/siteVisualEquivalenceSql src/test/siteVisualize
npx tsc --noEmit
npx eslint src/site/workspace/adapters/sql src/site/lib/sqlRunner.ts src/test/siteWorkspaceSqlSafety*.ts src/test/siteSqlQuestionIntegrity.test.ts
```

## 12. Interface requests (not edited here)

1. `lib/browserDb.ts` (coordinator): give `runQuery(sql, dataset, opts?)` and `submitQuery(..., dataset, opts?)` an optional `opts?: { policy?: PolicyOption }` and pass it to `execute`/`submit`. Then `browserBackend` can drop its copy of the time-limit wrapper (`withLimit` in `adapters/sql/backend.ts`).
2. `workspace/types.ts` (coordinator): none required. `sqlPolicy` is enough; grants are derived, not stored. If a content author must widen a lesson, a future `ExerciseDef.sqlAllow?: string[]` could carry grants explicitly.
3. Source repo `northwind-sql-practice` and its generator (section 9.5).
4. Optionally: pages that run Daily SQL exercises themselves (`components/daily/*`, `PracticePanel`) call `lib/sqlRunner` without a policy and are unchanged; to get the policy there, pass `policyOf(exercise)` from `workspace/adapters/sql` as `{ policy }`.
