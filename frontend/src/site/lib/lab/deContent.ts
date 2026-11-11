/** Data-engineering scenario challenges. See guided.ts for how they are validated. */
import type { GuidedExercise } from "./guided";

const sql = (id: string, title: string, instructions: string, starter: string, solution: string, check: string) => ({ id, title, type: "sql" as const, instructions, starter, solution, check });
const chk = (condition: string, message: string) => `SELECT ${condition} AS ok, '${message}' AS message`;

export const DE_SCENARIOS: GuidedExercise[] = [
  {
    id: "de-batch-upsert", title: "Batch ETL: load staging into the warehouse", level: "Beginner",
    context: "Each night a batch job lands changed sales in a staging table. The warehouse table must end up with every sale exactly once, using the newest amount.",
    requirements: ["Load stg_sales into dw_sales in one statement.", "New sale ids are inserted; existing ids get the staged amount."],
    inputs: ["stg_sales(sale_id, amount): 4 staged rows, two of them already in the warehouse", "dw_sales(sale_id primary key, amount): 3 rows"],
    expected: "5 rows in dw_sales. Sale 2 now has amount 250.", constraints: ["One INSERT statement is enough.", "Do not delete from dw_sales."], criteria: ["5 rows", "sale 2 updated to 250", "total 1,550"],
    explanation: "A batch load is an upsert: INSERT ... ON CONFLICT (key) DO UPDATE. It is set-based (one statement for the whole batch), atomic, and safe to repeat. Row-by-row loops in application code are slower and leave half-loaded tables when they fail.",
    hints: ["ON CONFLICT needs a unique key; dw_sales has a primary key on sale_id.", "EXCLUDED.amount is the value you tried to insert."],
    setup: `CREATE TABLE dw_sales (sale_id integer PRIMARY KEY, amount numeric);
INSERT INTO dw_sales VALUES (1,100),(2,200),(3,300);
CREATE TABLE stg_sales (sale_id integer, amount numeric);
INSERT INTO stg_sales VALUES (2,250),(3,300),(4,400),(5,500);`,
    task: sql("de-batch-upsert", "Batch ETL: load staging into the warehouse", "Load stg_sales into dw_sales.", "-- Load stg_sales into dw_sales\n",
      "INSERT INTO dw_sales SELECT sale_id, amount FROM stg_sales ON CONFLICT (sale_id) DO UPDATE SET amount = EXCLUDED.amount;",
      chk("(SELECT COUNT(*) FROM dw_sales) = 5 AND (SELECT amount FROM dw_sales WHERE sale_id = 2) = 250 AND (SELECT SUM(amount) FROM dw_sales) = 1550", "Expected 5 rows, sale 2 at 250 and a total of 1550.")),
  },
  {
    id: "de-large-csv", title: "Process a large CSV: aggregate in SQL", level: "Intermediate",
    context: "A 1,000-row event export was loaded as raw text into stg_events (imagine a million). A few rows have corrupt timestamps. Report events per day without loading rows into application memory.",
    requirements: ["Create daily_event_counts(event_date date, events bigint).", "Count events per calendar day.", "Skip rows whose timestamp is not in the form YYYY-MM-DD HH:MM:SS."],
    inputs: ["stg_events(event_id, event_ts, user_id, kind): all text, 1,003 rows"],
    expected: "Three days with 333, 334 and 333 events.", constraints: ["Do not fail on the corrupt rows.", "Do the work in one set-based statement."], criteria: ["Day counts 333, 334, 333 in date order"],
    explanation: "With big files, do the heavy work where the data lives. Staging everything as text and casting in SQL means one bad value cannot stop the load: validate the shape with a pattern first, cast only the rows that match, and count or quarantine the rest.",
    hints: ["Cast with a CASE that tests the pattern first.", "GROUP BY the date part."],
    setup: String.raw`CREATE TABLE stg_events (event_id text, event_ts text, user_id text, kind text);
INSERT INTO stg_events SELECT g::text, ('2026-02-0' || (1 + g % 3) || ' 10:00:00'), (g % 5)::text, CASE WHEN g % 4 = 0 THEN 'purchase' ELSE 'view' END FROM generate_series(1, 1000) g;
INSERT INTO stg_events VALUES ('x1','not a timestamp','1','view'),('x2','2026-13-99 25:00:00','2','view'),('x3','','3','view');`,
    task: sql("de-large-csv", "Process a large CSV: aggregate in SQL", "Create daily_event_counts.", "-- Create daily_event_counts here\n",
      String.raw`CREATE TABLE daily_event_counts AS SELECT (CASE WHEN event_ts ~ '^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01]) ([01]\d|2[0-3]):[0-5]\d:[0-5]\d$' THEN event_ts::timestamp END)::date AS event_date, COUNT(*) AS events FROM stg_events WHERE event_ts ~ '^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01]) ([01]\d|2[0-3]):[0-5]\d:[0-5]\d$' GROUP BY 1;`,
      chk("(SELECT array_agg(events ORDER BY event_date) FROM daily_event_counts) = ARRAY[333,334,333]::bigint[]", "Expected three days with 333, 334 and 333 events (corrupt rows skipped).")),
  },
  {
    id: "de-duplicate-transactions", title: "Identify and remove duplicate transactions", level: "Intermediate",
    context: "The payment provider resends webhooks, so the same transaction id arrives two or three times.",
    requirements: ["Create payments_unique with the same columns as payments and one row per txn_id.", "Keep the first one received (earliest received_at)."],
    inputs: ["payments(txn_id, account, amount, received_at): 7 rows, 4 distinct transactions"],
    expected: "4 rows totalling 65. Transaction t3 keeps its 09:07 row.", constraints: ["Never sum payments directly from the raw table."], criteria: ["4 rows", "total 65", "t3 received at 09:07"],
    explanation: "Duplicate deliveries are normal in at-least-once systems, so loads must deduplicate on a business key. Summing the raw table here would report 120 instead of 65. DISTINCT ON (txn_id) with ORDER BY txn_id, received_at keeps the earliest row per id.",
    hints: ["DISTINCT ON (txn_id) ... ORDER BY txn_id, received_at"],
    setup: `CREATE TABLE payments (txn_id text, account text, amount numeric, received_at timestamp);
INSERT INTO payments VALUES ('t1','A',10,'2026-03-01 09:00'),('t2','A',20,'2026-03-01 09:05'),('t2','A',20,'2026-03-01 09:06'),('t3','B',30,'2026-03-01 09:07'),('t3','B',30,'2026-03-01 09:30'),('t3','B',30,'2026-03-01 10:00'),('t4','B',5,'2026-03-01 11:00');`,
    task: sql("de-duplicate-transactions", "Identify and remove duplicate transactions", "Create payments_unique.", "-- Create payments_unique here\n",
      "CREATE TABLE payments_unique AS SELECT DISTINCT ON (txn_id) * FROM payments ORDER BY txn_id, received_at;",
      chk("(SELECT COUNT(*) FROM payments_unique) = 4 AND (SELECT SUM(amount) FROM payments_unique) = 65 AND (SELECT received_at FROM payments_unique WHERE txn_id = 't3') = TIMESTAMP '2026-03-01 09:07'", "Expected 4 rows totalling 65, with t3 at 09:07.")),
  },
  {
    id: "de-incremental-load", title: "Incremental loading with a watermark", level: "Intermediate",
    context: "Reloading the whole orders table every night is too slow. The job should copy only what changed since the last run and remember where it stopped.",
    requirements: ["Copy rows from src_orders with updated_at after the watermark into tgt_orders (insert new, update changed).", "Then move the watermark to the newest updated_at that was loaded."],
    inputs: ["src_orders(order_id, amount, updated_at)", "tgt_orders(order_id primary key, amount, updated_at): loaded up to the watermark", "etl_watermark(last_loaded): one row"],
    expected: "5 orders in tgt_orders, order 2 at amount 25 (it changed after the last run), and the watermark at 2026-04-03 08:00.", constraints: ["Do not reload rows older than the watermark."], criteria: ["5 rows", "order 2 amount is 25", "watermark is 2026-04-03 08:00"],
    explanation: "A watermark makes each run proportional to the change, not the table size. Changed rows must be upserted, not only inserted, or updates are lost. Move the watermark only after the load succeeds, and in the same transaction, so a failure cannot skip rows.",
    hints: ["The load is an upsert filtered by updated_at > watermark.", "UPDATE the watermark from the target's maximum updated_at."],
    setup: `CREATE TABLE src_orders (order_id integer PRIMARY KEY, amount numeric, updated_at timestamp);
INSERT INTO src_orders VALUES (1,10,'2026-04-01 08:00'),(2,20,'2026-04-01 09:00'),(3,30,'2026-04-02 08:00'),(4,40,'2026-04-02 09:00'),(5,50,'2026-04-03 08:00');
CREATE TABLE tgt_orders (order_id integer PRIMARY KEY, amount numeric, updated_at timestamp);
INSERT INTO tgt_orders SELECT * FROM src_orders WHERE updated_at <= '2026-04-01 12:00';
CREATE TABLE etl_watermark (last_loaded timestamp);
INSERT INTO etl_watermark VALUES ('2026-04-01 12:00');
UPDATE src_orders SET amount = 25, updated_at = '2026-04-02 10:00' WHERE order_id = 2;`,
    task: sql("de-incremental-load", "Incremental loading with a watermark", "Load the changes and move the watermark.", "-- Load rows changed since the watermark, then update the watermark\n",
      `INSERT INTO tgt_orders SELECT * FROM src_orders WHERE updated_at > (SELECT last_loaded FROM etl_watermark) ON CONFLICT (order_id) DO UPDATE SET amount = EXCLUDED.amount, updated_at = EXCLUDED.updated_at;
UPDATE etl_watermark SET last_loaded = (SELECT MAX(updated_at) FROM tgt_orders);`,
      chk("(SELECT COUNT(*) FROM tgt_orders) = 5 AND (SELECT amount FROM tgt_orders WHERE order_id = 2) = 25 AND (SELECT last_loaded FROM etl_watermark) = TIMESTAMP '2026-04-03 08:00'", "Expected 5 orders, order 2 at 25 and the watermark at 2026-04-03 08:00.")),
  },
  {
    id: "de-late-arriving", title: "Handle late-arriving records", level: "Advanced",
    context: "Some sales reach the warehouse days after they happened, and some arrive twice. The daily totals for those past days must be corrected.",
    requirements: ["Add the rows in late_sales to fact_sales, skipping any sale_id that is already there.", "Make daily_totals correct for every date again."],
    inputs: ["fact_sales(sale_id primary key, sale_date, amount): 3 rows", "late_sales(sale_id, sale_date, amount): 3 rows, one already loaded", "daily_totals(sale_date, total): built from fact_sales before the late rows arrived"],
    expected: "5 sales in fact_sales. daily_totals: 2026-05-01 is 175 and 2026-05-02 is 100.", constraints: ["Do not double count the sale that arrived twice."], criteria: ["5 facts", "totals 175 and 100 in date order"],
    explanation: "Late data changes history, so aggregates built earlier go stale. Insert idempotently (ON CONFLICT DO NOTHING) so duplicates are harmless, then recompute the affected partitions. Recomputing the touched dates is simpler and safer than trying to add deltas.",
    hints: ["ON CONFLICT (sale_id) DO NOTHING", "Rebuild daily_totals from fact_sales."],
    setup: `CREATE TABLE fact_sales (sale_id integer PRIMARY KEY, sale_date date, amount numeric);
INSERT INTO fact_sales VALUES (1,'2026-05-01',100),(2,'2026-05-01',50),(3,'2026-05-02',70);
CREATE TABLE late_sales (sale_id integer, sale_date date, amount numeric);
INSERT INTO late_sales VALUES (2,'2026-05-01',50),(4,'2026-05-01',25),(5,'2026-05-02',30);
CREATE TABLE daily_totals AS SELECT sale_date, SUM(amount) AS total FROM fact_sales GROUP BY sale_date;`,
    task: sql("de-late-arriving", "Handle late-arriving records", "Load late sales and fix the totals.", "-- Insert the late rows, then refresh daily_totals\n",
      `INSERT INTO fact_sales SELECT * FROM late_sales ON CONFLICT (sale_id) DO NOTHING;
DELETE FROM daily_totals;
INSERT INTO daily_totals SELECT sale_date, SUM(amount) FROM fact_sales GROUP BY sale_date;`,
      chk("(SELECT COUNT(*) FROM fact_sales) = 5 AND (SELECT array_agg(total ORDER BY sale_date) FROM daily_totals) = ARRAY[175,100]::numeric[]", "Expected 5 facts and daily totals 175 and 100.")),
  },
  {
    id: "de-validation", title: "Build a data validation step", level: "Intermediate",
    context: "Before loading users, the pipeline must split them into rows that are safe to load and rows that are rejected, with a reason so someone can fix them.",
    requirements: ["Create valid_users with the rows that have an email and an age from 0 to 120.", "Create rejected_users(user_id, reason) for the rest. Reason is 'missing_email' when the email is missing, otherwise 'bad_age'."],
    inputs: ["raw_users(user_id, email, age): 6 rows"],
    expected: "Valid users 1 and 5. Rejected: 2 missing_email, 3 bad_age, 4 bad_age, 6 missing_email.", constraints: ["Every row lands in exactly one of the two tables."], criteria: ["valid ids 1 and 5", "four rejected rows with the right reasons"],
    explanation: "Validation should never silently drop data: every row is either loaded or rejected with a reason you can count and report. Decide a priority when several rules fail (user 6 has both problems) so the result is deterministic.",
    hints: ["Use CASE for the reason, checking email first.", "valid_users is the opposite condition."],
    setup: `CREATE TABLE raw_users (user_id integer, email text, age integer);
INSERT INTO raw_users VALUES (1,'a@x.com',30),(2,NULL,25),(3,'c@x.com',-4),(4,'d@x.com',200),(5,'e@x.com',41),(6,NULL,-1);`,
    task: sql("de-validation", "Build a data validation step", "Create valid_users and rejected_users.", "-- Create valid_users and rejected_users\n",
      `CREATE TABLE valid_users AS SELECT * FROM raw_users WHERE email IS NOT NULL AND age BETWEEN 0 AND 120;
CREATE TABLE rejected_users AS SELECT user_id, CASE WHEN email IS NULL THEN 'missing_email' ELSE 'bad_age' END AS reason FROM raw_users WHERE NOT (email IS NOT NULL AND age BETWEEN 0 AND 120);`,
      chk("(SELECT array_agg(user_id ORDER BY user_id) FROM valid_users) = ARRAY[1,5] AND (SELECT array_agg(user_id || ':' || reason ORDER BY user_id) FROM rejected_users) = ARRAY['2:missing_email','3:bad_age','4:bad_age','6:missing_email']", "Expected valid users 1 and 5; rejected 2 and 6 for missing_email, 3 and 4 for bad_age.")),
  },
  {
    id: "de-idempotent", title: "Make the pipeline idempotent", level: "Advanced",
    context: "The load already ran once, then the source changed (item 3 is now 99) and the job was re-run after a failure. The naive INSERT ... SELECT doubles the table. Running the job twice must give the same result as running it once.",
    requirements: ["Write the load so it can be re-run safely.", "After your statement, tgt_items has exactly the three items from stg_items, with item 3 at quantity 99."],
    inputs: ["stg_items(item_id, qty): 3 rows, item 3 has qty 99", "tgt_items(item_id, qty): already holds the first load (item 3 still at 9)"],
    expected: "3 rows, one per item, item 3 at 99.", constraints: ["No duplicate rows, however many times the job runs."], criteria: ["3 rows", "3 distinct items", "item 3 is 99"],
    explanation: "Idempotent means the result depends on the data, not on how many times the job ran. Two common patterns: replace the target's contents in one transaction (TRUNCATE then INSERT), or upsert on a key. The starter's plain INSERT is not idempotent: each run adds the rows again.",
    hints: ["TRUNCATE + INSERT inside the same run is a full refresh.", "Or add a unique key and use ON CONFLICT."],
    setup: `CREATE TABLE stg_items (item_id integer, qty integer);
INSERT INTO stg_items VALUES (1,5),(2,7),(3,9);
CREATE TABLE tgt_items (item_id integer, qty integer);
INSERT INTO tgt_items SELECT * FROM stg_items;
UPDATE stg_items SET qty = 99 WHERE item_id = 3;`,
    task: sql("de-idempotent", "Make the pipeline idempotent", "Re-run the load safely.", "INSERT INTO tgt_items SELECT * FROM stg_items;\n",
      "TRUNCATE tgt_items;\nINSERT INTO tgt_items SELECT * FROM stg_items;",
      chk("(SELECT COUNT(*) FROM tgt_items) = 3 AND (SELECT COUNT(DISTINCT item_id) FROM tgt_items) = 3 AND (SELECT qty FROM tgt_items WHERE item_id = 3) = 99", "Expected 3 rows, one per item, with item 3 at 99. A plain INSERT doubles the data.")),
  },
  {
    id: "de-failed-batch", title: "Handle a failed batch with a quarantine table", level: "Intermediate",
    context: "A batch has a few values that are not numbers. One bad row must not stop the whole load, and nothing may be lost silently.",
    requirements: ["Create tgt_good(id integer, value numeric) with the rows whose value is a plain number (optional minus sign, digits, optional decimals).", "Create quarantine(id integer, value text, error text) with every other row and the error 'not_a_number'."],
    inputs: ["stg_batch(id, value as text): 6 rows"],
    expected: "Good ids 1, 3, 5 (total 20.75). Quarantined ids 2, 4, 6.", constraints: ["Do not cast values that are not numbers.", "Every row goes to exactly one table."], criteria: ["good ids and total", "quarantined ids and error text"],
    explanation: "A dead-letter (quarantine) table keeps bad rows with the reason so they can be fixed and replayed, while good rows load. Test the shape with a pattern before casting: casting '1e3' or 'abc' would raise an error and abort the whole statement. Note '1e3' is rejected here because the rule says plain numbers only.",
    hints: [String.raw`value ~ '^-?\d+(\.\d+)?$'`], 
    setup: `CREATE TABLE stg_batch (id integer, value text);
INSERT INTO stg_batch VALUES (1,'10.5'),(2,'abc'),(3,'7'),(4,''),(5,'3.25'),(6,'1e3');`,
    task: sql("de-failed-batch", "Handle a failed batch with a quarantine table", "Create tgt_good and quarantine.", "-- Create tgt_good and quarantine\n",
      String.raw`CREATE TABLE tgt_good AS SELECT id, CASE WHEN value ~ '^-?\d+(\.\d+)?$' THEN value::numeric END AS value FROM stg_batch WHERE value ~ '^-?\d+(\.\d+)?$';
CREATE TABLE quarantine AS SELECT id, value, 'not_a_number' AS error FROM stg_batch WHERE value !~ '^-?\d+(\.\d+)?$';`,
      chk("(SELECT array_agg(id ORDER BY id) FROM tgt_good) = ARRAY[1,3,5] AND (SELECT SUM(value) FROM tgt_good) = 20.75 AND (SELECT array_agg(id ORDER BY id) FROM quarantine) = ARRAY[2,4,6] AND (SELECT COUNT(*) FROM quarantine WHERE error = 'not_a_number') = 3", "Expected good ids 1, 3, 5 (total 20.75) and quarantined ids 2, 4, 6 with error not_a_number.")),
  },
  {
    id: "de-reconcile", title: "Reconcile source and target", level: "Advanced",
    context: "After a migration, finance asks whether the target matches the source. You need a report of every difference, not just a row count.",
    requirements: ["Create recon_report(kind text, account_id integer).", "kind is 'missing_in_target' (in source only), 'extra_in_target' (in target only) or 'balance_mismatch' (in both, balances differ)."],
    inputs: ["src_accounts(account_id, balance): 4 rows", "tgt_accounts(account_id, balance): 4 rows"],
    expected: "balance_mismatch for 2, extra_in_target for 5, missing_in_target for 3. Account 1 and 4 match.", constraints: ["Matching accounts must not appear."], criteria: ["exactly three report rows with the right kind and id"],
    explanation: "Equal row counts can hide offsetting differences (here both tables have 4 rows). A FULL OUTER JOIN on the key finds rows on only one side, and comparing the values on matched rows finds mismatches. Use IS DISTINCT FROM so NULL balances compare correctly.",
    hints: ["FULL OUTER JOIN src_accounts s ON ... tgt_accounts t", "s.balance IS DISTINCT FROM t.balance for the mismatch."],
    setup: `CREATE TABLE src_accounts (account_id integer, balance numeric);
INSERT INTO src_accounts VALUES (1,100),(2,200),(3,300),(4,400);
CREATE TABLE tgt_accounts (account_id integer, balance numeric);
INSERT INTO tgt_accounts VALUES (1,100),(2,250),(4,400),(5,500);`,
    task: sql("de-reconcile", "Reconcile source and target", "Create recon_report.", "-- Create recon_report here\n",
      `CREATE TABLE recon_report AS SELECT CASE WHEN t.account_id IS NULL THEN 'missing_in_target' WHEN s.account_id IS NULL THEN 'extra_in_target' ELSE 'balance_mismatch' END AS kind, COALESCE(s.account_id, t.account_id) AS account_id
FROM src_accounts s FULL OUTER JOIN tgt_accounts t ON t.account_id = s.account_id
WHERE s.account_id IS NULL OR t.account_id IS NULL OR s.balance IS DISTINCT FROM t.balance;`,
      chk("(SELECT array_agg(kind || ':' || account_id ORDER BY kind, account_id) FROM recon_report) = ARRAY['balance_mismatch:2','extra_in_target:5','missing_in_target:3']", "Expected balance_mismatch:2, extra_in_target:5 and missing_in_target:3.")),
  },
  {
    id: "de-retry", title: "Implement retry logic with backoff", level: "Intermediate",
    context: "A pipeline step calls a flaky API. It should retry a few times, waiting longer after each failure, and give up with the real error when it is out of attempts.",
    requirements: ["Write retry(fn, attempts, base_delay, sleep).", "Call fn(). If it raises, wait base_delay * 2**n seconds (n = failures so far) by calling sleep(seconds), then try again.", "Make at most `attempts` calls. Return the result of the first success. After the last failure re-raise the exception, without sleeping after it."],
    inputs: ["fn: a function taking no arguments", "sleep: a function you call instead of time.sleep, so the delays can be tested"], expected: "A flaky function that fails twice then works returns its result after sleeping 1 then 2 seconds (base_delay 1).", constraints: ["Standard library only.", "Do not catch BaseException (like KeyboardInterrupt)."], criteria: ["Visible and hidden tests pass"],
    explanation: "Retries absorb transient failures; exponential backoff stops a struggling service from being hit at full speed. Inject `sleep` so tests run instantly and can check the delays. Re-raise the final error unchanged so the cause is not hidden, and never sleep after the last attempt: that only delays the failure.",
    hints: ["Loop `for n in range(attempts)` and compare n with attempts - 1 inside the except block."], setup: "",
    task: {
      id: "de-retry", title: "Implement retry logic with backoff", type: "python", instructions: "Write retry(fn, attempts, base_delay, sleep).",
      starter: "def retry(fn, attempts, base_delay, sleep):\n    raise NotImplementedError\n",
      solution: "def retry(fn, attempts, base_delay, sleep):\n    for n in range(attempts):\n        try:\n            return fn()\n        except Exception:\n            if n == attempts - 1:\n                raise\n            sleep(base_delay * 2 ** n)\n",
      tests: "delays = []\ncalls = {'n': 0}\ndef flaky():\n    calls['n'] += 1\n    if calls['n'] < 3:\n        raise RuntimeError('boom')\n    return 'ok'\nassert retry(flaky, 5, 1, delays.append) == 'ok'\nassert delays == [1, 2]\nassert calls['n'] == 3\nd2 = []\nassert retry(lambda: 7, 3, 1, d2.append) == 7\nassert d2 == []",
      hidden: "d = []\ndef bad():\n    raise ValueError('nope')\ntry:\n    retry(bad, 4, 0.5, d.append)\n    assert False, 'should have raised'\nexcept ValueError as e:\n    assert str(e) == 'nope'\nassert d == [0.5, 1.0, 2.0]\nd1 = []\ntry:\n    retry(bad, 1, 1, d1.append)\nexcept ValueError:\n    pass\nassert d1 == []",
    },
  },
];
