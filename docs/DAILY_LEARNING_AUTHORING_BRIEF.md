# Daily Learning: authoring brief for lesson writers

## Rules for the concurrent authoring waves (these override anything below that conflicts)

- **One writing location.** All work happens in the integration worktree `/Users/subramanyaacharya/Downloads/project/sql-practice-platform-integration` (branch `integration/daily-learning-evolution`). Never write to `/Users/subramanyaacharya/Downloads/project/sql-practice-platform` (the original checkout) or `../sql-practice-platform-evolution`.
- **Exclusive ownership.** You write only the `<id>.md` and `<id>.json` files for the ids assigned to you, in `frontend/src/site/content/daily/days/`. Nobody else writes those ids, and you write no other file in the repository. Do not edit `curriculum.json`, the manifest, the coverage report, tests, library code or docs. Do not run git commands.
- **No manifest.** Do not touch `docs/DAILY_LEARNING_AUTHORING_MANIFEST.jsonl`. The coordinator records a lesson only after validating it independently.
- **Validation you run:** `cd /Users/subramanyaacharya/Downloads/project/sql-practice-platform-integration/frontend && DAILY_DAYS=<id or range> npx vitest run src/test/siteDaily.test.ts --maxConcurrency=2` after every lesson. Fix every failure. Use `--maxConcurrency=2` (the machine is shared by ten writers).
- **Validation you do not run:** do not run `scripts/daily-browser-verify.mjs` or any browser. The coordinator runs the real-Pyodide check and the SQL check centrally. Write browser-run examples carefully anyway, following the platform rules in `docs/DAILY_LEARNING_CONTENT.md` (32-bit browser: no default-integer dtype prints; pandas FutureWarnings fail the test; seeded `rng.random/integers/normal` only; no `pd.Timedelta(days=n)`: use `pd.to_timedelta(n, unit="D")` or `pd.DateOffset`).
- **Save each lesson as soon as it passes**, then continue. Work in chunks of about five lessons. If you receive an API 429 or rate-limit error, stop immediately, keep every file already saved, and report which ids are saved and which are unfinished.
- **Scratch files** go in your own private folder under the scratchpad directory, never in the repository.
- **Dependencies on other writers' days.** Days are written concurrently, so a lesson before yours may not exist yet. Use the curriculum titles and topics for earlier days, and never assume details of a lesson you cannot read. Where the plan gives a shared specification (below), follow it exactly so concurrently written days agree.
- **Final report** (short): ids saved, your range test line, per-day theory prose words, links, days needing software the browser cannot run and their graded alternatives, unverified facts, problems.

### Shared specifications for concurrently written days

- **Power BI sample model (analyst a124–a137, written by two writers):** tables `Sales(order_id, order_date, customer_id, product_id, quantity, unit_price)`, `Customers(customer_id, customer_name, country, segment)`, `Products(product_id, product_name, category, unit_cost)`, and a `Calendar` date table (date, year, quarter, month_number, month_name). Sales is the fact table; one-to-many relationships Customers to Sales, Products to Sales, Calendar to Sales on order_date. Revenue = `quantity * unit_price`. Define the same small data in pandas inside each day's code (a seeded `np.random.default_rng(7)`, 12 months of 2025, 40 customers, 12 products, 400 orders).
- **Orders API stand-in (engineer e101–e113, written by two writers):** `GET /orders?page=N&page_size=P` returning `{"data": [...], "page": N, "total_pages": T}` with order records `{order_id, customer_id, amount_cents, currency, status, created_at}`, 120 orders, statuses `paid|refunded|failed`, API key header `X-Api-Key`, a 429 with `Retry-After` on every third request in the rate-limit days. Target table `orders(order_id PRIMARY KEY, customer_id, amount_cents, currency, status, created_at)`.
- **Engineer ETL pipeline (e120–e131, written by two writers):** extract orders from a list/CSV text, transform with small pure functions (`clean_amount`, `parse_ts`, `dedupe_latest`), load into a `sqlite3` table `orders_clean`; incremental runs track a `watermark` stored in a one-row table `etl_state`.
- **Capstones:** each capstone route is written by one writer from its first day, so the project stays coherent.


You write complete lessons for DataForge's Daily Learning programme. Each lesson is one learner-day of about two hours.
Repository: `/Users/subramanyaacharya/Downloads/project/sql-practice-platform-integration`. Work only inside `frontend/src/site/content/daily/days/`.

## Rules

- Do not run any git command. Do not switch branches. Other writers work in the same folder at the same time.
- Create only the files for your own day ids: `<id>.md` and `<id>.json`. Never edit, delete or rename any other file. That includes `curriculum.json`, the test, the library code, the docs and other writers' lessons.
- If you think the curriculum entry for a day is wrong (title, topics, prerequisites), do not change it. Write the lesson to the listed topics and describe the problem in your report.
- If the spec or the test seems wrong, finish as far as possible and describe the defect in your report. Do not work around it silently.
- Everything you write is persisted learner documentation: full, clear sentences. No filler, no motivational padding, no repeated paragraphs between days.

## Read first

1. `docs/DAILY_LEARNING_CONTENT.md`: the lesson and exercise format, fence tags, rules for output stability and for tools the browser cannot run. Follow it exactly.
2. `frontend/src/test/siteDaily.test.ts`: the checks your files must pass.
3. Two finished lessons as models of depth and style: `frontend/src/site/content/daily/days/d004.md` and `d004.json` (Python), `d033.md` and `d033.json` (SQL).
4. `frontend/src/site/content/daily/curriculum.json`: the entries for your days (title, topics, minutes, prerequisites, phase) and for the days just before and after them. Also skim the whole phase list, so you know what is taught before and after your days.
5. Existing DataForge material to link to by reference (never copy): notes in `frontend/src/site/content/notes/*/`, Python exercises in `frontend/src/site/content/python/`, SQL questions in `frontend/public/data/index.json`, projects in `frontend/src/site/content/tracks.json`, mind maps in `frontend/src/site/content/mindmaps/`, SQL patterns in `frontend/src/site/content/patterns/`. Every link must exist (the test checks). Choose 2 to 5 links that really match the day's topic and level. Read frontmatter to choose. If nothing fits, link the best match from the phase's notes.

## Workflow, one day at a time

1. Plan the day: the objectives, the three or four ideas, the worked examples in increasing difficulty, and exercises that combine them.
2. Write `<id>.md`, then `<id>.json`. Produce every `output` block and every `expected` value by running the code. Never write output from memory.
3. Run the checks for your range and fix every failure:
   `cd /Users/subramanyaacharya/Downloads/project/sql-practice-platform-integration/frontend && DAILY_DAYS=<first>..<last> npx vitest run src/test/siteDaily.test.ts --maxConcurrency=4`
   Use your own range. While you work through a range the later days do not exist yet; the checks only look at days that have files.
4. Only then start the next day. Never leave a day with one of its two files.
5. After the last day, run the checks for the whole range once more.

Python for tests is `/Users/subramanyaacharya/Downloads/project/sql-practice-platform-integration/.venv-daily/bin/python` (numpy, pandas, scipy, statsmodels, matplotlib, seaborn, plotly, requests, sqlalchemy, pytest, openpyxl, pydantic). For SQL, the test runs your query on the browser database (PGlite) and prints the result as text, so run the test to see the exact text. You can also explore with `npx vitest` output or small node scripts that you delete afterwards; leave no helper files behind.

## Quality bar

- **Genuine two-hour sessions.** Detailed theory in plain language: define every term at first use, explain why before how, include a worked mental model or analogy, and name the common misconception. `## Understand` is 700 to 1100 words for a lesson day (250 or more for project, checkpoint and capstone days) with `###` subsections.
- **Syntax and key functions.** A compact reference: each syntax form in a fenced block, an explanation of each part, and a table of the functions or options introduced that day with what they return.
- **Three to six worked examples**, in increasing difficulty, each with a short explanation of what happens and why. The last example should combine ideas or show a realistic case.
- **Real-world applications**: two to four concrete data-work uses tied to the day's content.
- **Daily review**: `### Key takeaways`, `### Common mistakes` (real mistakes beginners make, with what the error or wrong result looks like and how to fix it), `### Revision notes`.
- **Revision task**: one task for a later day, with a way to check it.
- **Exercises**: 3 or 4 guided (3 hints each, gentlest first), 2 or 3 independent (no hints, harder, combining ideas, one may be a stretch with `"required": false`). Prompts are precise: say the exact output format or the exact columns. Starters never already pass. Solutions are clean and idiomatic for the level.
- **Knowledge checks**: 4 to 6 questions that test understanding, not wording: include "what does this print or return" questions you verified by running, and wrong options that match real misconceptions.
- **Sequencing**: teach the listed topics only; do not use ideas from later days; use earlier days' ideas freely and cross-reference them. The `Next-day preparation` section names the next day's topic and gives a small thing to try.
- **Technical accuracy** over everything. If you are unsure of a fact about a tool, leave it out or verify it by running it. PostgreSQL syntax is for PostgreSQL 16 and above; the browser database is a newer PostgreSQL, so avoid behaviour that changed between versions.
- **Level and tone**: written for a learner who finished the earlier days. Do not skip steps that would lose them.

## Tools the browser cannot run

Excel, Power Query, DAX, Power BI, Airflow, Spark, Docker, GitHub, real APIs, real PostgreSQL servers: follow the rules in `docs/DAILY_LEARNING_CONTENT.md`. In short:

- Show the tool's formulas or code in untagged fences. Verify every number you quote by computing it with a `python run` or `sql run` example that does the same job.
- Use `python local` for `matplotlib`, `seaborn`, `plotly`, `requests`, `sqlalchemy`, `openpyxl`, `pytest` and `pydantic`, `bash run` for shell and Git, and set `environment` in the JSON file (packages and a note).
- Give every such day a graded pure-Python, pandas or SQL version of the skill (the reproducible alternative), plus `written` exercises for the part only the tool can do. Keep `written` to the minority of a day's exercises.
- Real database code (`psycopg`, PostgreSQL `COPY`, `ON CONFLICT`): show it, explain it, and run the equivalent logic on `sqlite3` (Python) or PGlite (`sql run`) in the examples. Say clearly where the stand-in differs from PostgreSQL (placeholders, types, `ON CONFLICT` is available in SQLite 3.24 and later, and so on).

## Report back (keep it short)

- The ids you wrote and the final test line for your range.
- Per day: examples (run / local / bash counts), exercises (graded / written), links chosen. A compact table is fine.
- Every day that needs software the browser cannot run, and what the reproducible alternative is.
- Problems with the curriculum entries, spec or test; facts you could not verify; any topic you deliberately left out and why.
Do not paste lesson content into the report.
