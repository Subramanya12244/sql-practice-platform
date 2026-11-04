---
title: CSV to PostgreSQL ETL pipeline
slug: csv-to-postgres-etl
level: Beginner
description: Parse a messy CSV export in Python, stage it in PostgreSQL, remove duplicate orders and make the load safe to re-run.
technologies: [Python, PostgreSQL, SQL]
dataset: sales
prerequisites: [python-csv-json, python-database-connectivity, etl-loading, etl-idempotency]
minutes: 90
---
## Business problem

The sales team exports orders from the CRM as a CSV file every night. Finance wants the same numbers in PostgreSQL so they can query revenue. The export is messy: it has stray whitespace, blank amounts, bad dates and the occasional duplicated row. Re-running a failed load must never double the revenue.

## Learning objectives

- Parse and clean CSV text with the `csv` module
- Build parameterised `INSERT` statements instead of string-formatted SQL
- Load a typed staging table with a primary key
- Detect business duplicates that have different ids
- Make a load idempotent with `ON CONFLICT DO NOTHING`

## Architecture

The pipeline reads the CSV, cleans each row in Python, and writes batches to a staging table. SQL then builds a clean table from staging.

```mermaid
flowchart LR
  csv["orders.csv"] --> parse["Python parse and clean"]
  parse --> stage["staging_orders"]
  stage --> clean["clean_orders"]
  clean --> bi["Finance queries"]
```

## Technologies

- **Python 3** standard library: `csv`, `io`, `datetime`
- **PostgreSQL 16**: primary keys, `INSERT … SELECT`, `ON CONFLICT`
- A driver such as `psycopg` for the real load (checklist task)

## Dataset

The SQL tasks use the **sales** dataset: `orders` (623 rows) and `order_items` (1579 rows). Orders 621–623 duplicate orders 5, 77 and 300: same customer, date and lines, but new ids. The Python tasks use small inline CSV strings.

## Tasks

Work through the tasks in order. Python tasks run in your browser. Each task runs in its own rolled-back transaction, so create every table the check needs in this task.

```task
{
 "id": "parse-csv",
 "title": "Parse and clean the CSV export",
 "type": "python",
 "instructions": "Write `parse_orders(text)` that returns a list of dicts with keys `order_id` (int), `customer_id` (int), `order_date` (`datetime.date`) and `amount` (float).\n\n- Strip whitespace from every field.\n- Skip rows whose date is not `YYYY-MM-DD` or whose amount is blank or not a number.\n- Keep only the first row for each `order_id`.",
 "starter": "import csv, io\nfrom datetime import date, datetime\n\nRAW = \"\"\"order_id,customer_id,order_date,amount\n1, 10 ,2024-01-03, 120.50\n2,11,2024-13-01,99\n3,12,2024-01-05,\n1,10,2024-01-03,120.50\n4, 13,2024-01-07,75.25\n5,14,2024-01-08,abc\n6,15, 2024-01-09 ,10\n\"\"\"\n\ndef parse_orders(text):\n    # TODO: read with csv.DictReader(io.StringIO(text))\n    return []\n",
 "solution": "import csv, io\nfrom datetime import date, datetime\n\nRAW = \"\"\"order_id,customer_id,order_date,amount\n1, 10 ,2024-01-03, 120.50\n2,11,2024-13-01,99\n3,12,2024-01-05,\n1,10,2024-01-03,120.50\n4, 13,2024-01-07,75.25\n5,14,2024-01-08,abc\n6,15, 2024-01-09 ,10\n\"\"\"\n\ndef parse_orders(text):\n    rows, seen = [], set()\n    for raw in csv.DictReader(io.StringIO(text)):\n        r = {k.strip(): (v or '').strip() for k, v in raw.items()}\n        try:\n            d = datetime.strptime(r['order_date'], '%Y-%m-%d').date()\n            amount = float(r['amount'])\n            oid = int(r['order_id'])\n        except ValueError:\n            continue\n        if oid in seen:\n            continue\n        seen.add(oid)\n        rows.append({'order_id': oid, 'customer_id': int(r['customer_id']), 'order_date': d, 'amount': amount})\n    return rows\n",
 "tests": "rows = parse_orders(RAW)\nassert [r['order_id'] for r in rows] == [1, 4, 6], rows\nassert rows[0] == {'order_id': 1, 'customer_id': 10, 'order_date': date(2024, 1, 3), 'amount': 120.5}\nassert rows[2]['order_date'] == date(2024, 1, 9)\nassert all(isinstance(r['amount'], float) for r in rows)"
}
```

```task
{
 "id": "parameterised-insert",
 "title": "Build parameterised INSERT batches",
 "type": "python",
 "instructions": "Write two functions.\n\n- `build_insert(table, rows)` returns `(sql, params)`. `sql` is `INSERT INTO <table> (c1, c2, …) VALUES (%s, %s, …)`, with the columns taken from the first row's keys in order. `params` is a list of tuples, one per row.\n- `chunks(items, size)` yields consecutive lists of at most `size` items.\n\nNever put values into the SQL string.",
 "starter": "def build_insert(table, rows):\n    # TODO\n    sql = f\"INSERT INTO {table} VALUES ({rows})\"\n    return sql, []\n\ndef chunks(items, size):\n    yield items\n",
 "solution": "def build_insert(table, rows):\n    cols = list(rows[0].keys())\n    sql = f\"INSERT INTO {table} ({', '.join(cols)}) VALUES ({', '.join(['%s'] * len(cols))})\"\n    params = [tuple(r[c] for c in cols) for r in rows]\n    return sql, params\n\ndef chunks(items, size):\n    for i in range(0, len(items), size):\n        yield items[i:i + size]\n",
 "tests": "sql, params = build_insert('staging_orders', [{'order_id': 1, 'amount': 2.5}, {'order_id': 2, 'amount': 3.0}])\nassert sql == 'INSERT INTO staging_orders (order_id, amount) VALUES (%s, %s)', sql\nassert params == [(1, 2.5), (2, 3.0)]\nsql2, p2 = build_insert('t', [{'name': \"O'Brien\"}])\nassert \"O'Brien\" not in sql2 and p2 == [(\"O'Brien\",)]\nassert [len(c) for c in chunks(list(range(7)), 3)] == [3, 3, 1]"
}
```

```task
{
 "id": "stage-orders",
 "title": "Load a typed staging table",
 "type": "sql",
 "instructions": "Create `staging_orders` with columns `order_id` (INTEGER PRIMARY KEY), `customer_id`, `order_date`, `status` and `order_total` NUMERIC(12,2).\n\nFill it with one row per order that has line items. `order_total` is `SUM(quantity * unit_price * (1 - discount))` rounded to 2 decimals.",
 "starter": "-- TODO: CREATE TABLE staging_orders (...)\n-- TODO: INSERT INTO staging_orders SELECT ... FROM orders JOIN order_items ...\n",
 "solution": "CREATE TABLE staging_orders (\n  order_id INTEGER PRIMARY KEY,\n  customer_id INTEGER NOT NULL,\n  order_date DATE NOT NULL,\n  status VARCHAR(12) NOT NULL,\n  order_total NUMERIC(12,2) NOT NULL\n);\nINSERT INTO staging_orders (order_id, customer_id, order_date, status, order_total)\nSELECT o.order_id, o.customer_id, o.order_date, o.status,\n       ROUND(SUM(oi.quantity * oi.unit_price * (1 - oi.discount)), 2)\nFROM orders o\nJOIN order_items oi ON oi.order_id = o.order_id\nGROUP BY o.order_id, o.customer_id, o.order_date, o.status;",
 "check": "SELECT (COALESCE(((SELECT COUNT(*) FROM information_schema.columns WHERE table_schema = current_schema() AND table_name = 'staging_orders' AND column_name IN ('order_id','customer_id','order_date','status','order_total')) = 5), FALSE) AND COALESCE(((SELECT COUNT(*) FROM staging_orders) = (SELECT COUNT(DISTINCT order_id) FROM order_items)), FALSE) AND COALESCE(((SELECT COUNT(DISTINCT order_id) FROM staging_orders) = (SELECT COUNT(*) FROM staging_orders)), FALSE) AND COALESCE(((SELECT SUM(order_total) FROM staging_orders) = (SELECT SUM(t) FROM (SELECT ROUND(SUM(quantity*unit_price*(1-discount)),2) t FROM order_items GROUP BY order_id) x)), FALSE) AND COALESCE((EXISTS (SELECT 1 FROM information_schema.table_constraints WHERE table_name = 'staging_orders' AND constraint_type = 'PRIMARY KEY')), FALSE)) AS ok, CASE WHEN NOT COALESCE(((SELECT COUNT(*) FROM information_schema.columns WHERE table_schema = current_schema() AND table_name = 'staging_orders' AND column_name IN ('order_id','customer_id','order_date','status','order_total')) = 5), FALSE) THEN 'staging_orders needs order_id, customer_id, order_date, status, order_total' WHEN NOT COALESCE(((SELECT COUNT(*) FROM staging_orders) = (SELECT COUNT(DISTINCT order_id) FROM order_items)), FALSE) THEN 'staging_orders needs one row per order that has line items' WHEN NOT COALESCE(((SELECT COUNT(DISTINCT order_id) FROM staging_orders) = (SELECT COUNT(*) FROM staging_orders)), FALSE) THEN 'order_id must be unique' WHEN NOT COALESCE(((SELECT SUM(order_total) FROM staging_orders) = (SELECT SUM(t) FROM (SELECT ROUND(SUM(quantity*unit_price*(1-discount)),2) t FROM order_items GROUP BY order_id) x)), FALSE) THEN 'order_total does not match the line items (remember the discount and rounding)' WHEN NOT COALESCE((EXISTS (SELECT 1 FROM information_schema.table_constraints WHERE table_name = 'staging_orders' AND constraint_type = 'PRIMARY KEY')), FALSE) THEN 'add a PRIMARY KEY on order_id' ELSE 'staging_orders is loaded and reconciles with order_items' END AS message"
}
```

```task
{
 "id": "dedupe-orders",
 "title": "Remove business duplicates",
 "type": "sql",
 "instructions": "Orders 621–623 are re-sent copies of earlier orders with new ids. Create `clean_orders` with the same columns as `staging_orders`. Keep one row per (`customer_id`, `order_date`, `order_total`): the one with the lowest `order_id`.\n\nInclude the `staging_orders` load from the previous task first.",
 "starter": "CREATE TABLE staging_orders (\n  order_id INTEGER PRIMARY KEY,\n  customer_id INTEGER NOT NULL,\n  order_date DATE NOT NULL,\n  status VARCHAR(12) NOT NULL,\n  order_total NUMERIC(12,2) NOT NULL\n);\nINSERT INTO staging_orders (order_id, customer_id, order_date, status, order_total)\nSELECT o.order_id, o.customer_id, o.order_date, o.status,\n       ROUND(SUM(oi.quantity * oi.unit_price * (1 - oi.discount)), 2)\nFROM orders o\nJOIN order_items oi ON oi.order_id = o.order_id\nGROUP BY o.order_id, o.customer_id, o.order_date, o.status;\n\n-- TODO: build clean_orders without the duplicates\nCREATE TABLE clean_orders AS SELECT * FROM staging_orders;",
 "solution": "CREATE TABLE staging_orders (\n  order_id INTEGER PRIMARY KEY,\n  customer_id INTEGER NOT NULL,\n  order_date DATE NOT NULL,\n  status VARCHAR(12) NOT NULL,\n  order_total NUMERIC(12,2) NOT NULL\n);\nINSERT INTO staging_orders (order_id, customer_id, order_date, status, order_total)\nSELECT o.order_id, o.customer_id, o.order_date, o.status,\n       ROUND(SUM(oi.quantity * oi.unit_price * (1 - oi.discount)), 2)\nFROM orders o\nJOIN order_items oi ON oi.order_id = o.order_id\nGROUP BY o.order_id, o.customer_id, o.order_date, o.status;\n\nCREATE TABLE clean_orders AS\nSELECT order_id, customer_id, order_date, status, order_total\nFROM (\n  SELECT s.*, ROW_NUMBER() OVER (PARTITION BY customer_id, order_date, order_total ORDER BY order_id) AS rn\n  FROM staging_orders s\n) d\nWHERE rn = 1;",
 "check": "SELECT (COALESCE(((SELECT COUNT(*) FROM clean_orders) = (SELECT COUNT(*) FROM (SELECT DISTINCT customer_id, order_date, order_total FROM staging_orders) d)), FALSE) AND COALESCE((NOT EXISTS (SELECT 1 FROM clean_orders WHERE order_id IN (621, 622, 623))), FALSE) AND COALESCE((EXISTS (SELECT 1 FROM clean_orders WHERE order_id = 5) AND EXISTS (SELECT 1 FROM clean_orders WHERE order_id = 300)), FALSE)) AS ok, CASE WHEN NOT COALESCE(((SELECT COUNT(*) FROM clean_orders) = (SELECT COUNT(*) FROM (SELECT DISTINCT customer_id, order_date, order_total FROM staging_orders) d)), FALSE) THEN 'clean_orders should hold one row per customer, date and total' WHEN NOT COALESCE((NOT EXISTS (SELECT 1 FROM clean_orders WHERE order_id IN (621, 622, 623))), FALSE) THEN 'orders 621-623 are the duplicates and must be removed' WHEN NOT COALESCE((EXISTS (SELECT 1 FROM clean_orders WHERE order_id = 5) AND EXISTS (SELECT 1 FROM clean_orders WHERE order_id = 300)), FALSE) THEN 'keep the original orders (lowest order_id)' ELSE 'Duplicates removed, originals kept' END AS message"
}
```

```task
{
 "id": "idempotent-load",
 "title": "Make the load safe to re-run",
 "type": "sql",
 "instructions": "A retried job runs the same load twice. Create `staging_orders` (with its primary key) and run the `INSERT … SELECT` **twice**. The second run must not fail and must not add rows. Use `ON CONFLICT (order_id) DO NOTHING`.",
 "starter": "CREATE TABLE staging_orders (order_id INTEGER, customer_id INTEGER, order_date DATE, status VARCHAR(12), order_total NUMERIC(12,2));\n-- TODO: make this INSERT idempotent, then run it twice\nINSERT INTO staging_orders\nSELECT o.order_id, o.customer_id, o.order_date, o.status, ROUND(SUM(oi.quantity * oi.unit_price * (1 - oi.discount)), 2)\nFROM orders o JOIN order_items oi ON oi.order_id = o.order_id\nGROUP BY o.order_id, o.customer_id, o.order_date, o.status;\nINSERT INTO staging_orders\nSELECT o.order_id, o.customer_id, o.order_date, o.status, ROUND(SUM(oi.quantity * oi.unit_price * (1 - oi.discount)), 2)\nFROM orders o JOIN order_items oi ON oi.order_id = o.order_id\nGROUP BY o.order_id, o.customer_id, o.order_date, o.status;",
 "solution": "CREATE TABLE staging_orders (order_id INTEGER PRIMARY KEY, customer_id INTEGER, order_date DATE, status VARCHAR(12), order_total NUMERIC(12,2));\nINSERT INTO staging_orders\nSELECT o.order_id, o.customer_id, o.order_date, o.status, ROUND(SUM(oi.quantity * oi.unit_price * (1 - oi.discount)), 2)\nFROM orders o JOIN order_items oi ON oi.order_id = o.order_id\nGROUP BY o.order_id, o.customer_id, o.order_date, o.status\nON CONFLICT (order_id) DO NOTHING;\nINSERT INTO staging_orders\nSELECT o.order_id, o.customer_id, o.order_date, o.status, ROUND(SUM(oi.quantity * oi.unit_price * (1 - oi.discount)), 2)\nFROM orders o JOIN order_items oi ON oi.order_id = o.order_id\nGROUP BY o.order_id, o.customer_id, o.order_date, o.status\nON CONFLICT (order_id) DO NOTHING;",
 "check": "SELECT (COALESCE(((SELECT COUNT(*) FROM staging_orders) = (SELECT COUNT(DISTINCT order_id) FROM order_items)), FALSE) AND COALESCE((EXISTS (SELECT 1 FROM information_schema.table_constraints WHERE table_name = 'staging_orders' AND constraint_type = 'PRIMARY KEY')), FALSE)) AS ok, CASE WHEN NOT COALESCE(((SELECT COUNT(*) FROM staging_orders) = (SELECT COUNT(DISTINCT order_id) FROM order_items)), FALSE) THEN 'after two runs staging_orders must still hold one row per order' WHEN NOT COALESCE((EXISTS (SELECT 1 FROM information_schema.table_constraints WHERE table_name = 'staging_orders' AND constraint_type = 'PRIMARY KEY')), FALSE) THEN 'staging_orders needs a PRIMARY KEY so conflicts can be detected' ELSE 'The load is idempotent' END AS message"
}
```

```task
{
 "id": "run-locally",
 "title": "Run the pipeline against your own PostgreSQL",
 "type": "checklist",
 "instructions": "Wire the pieces together outside the browser.",
 "items": [
  "Create a virtual environment and `pip install psycopg[binary]`",
  "Load the sales dataset into a local PostgreSQL 16 database",
  "Write `load.py` that reads a CSV file, calls `parse_orders`, and inserts batches of 500 with `cursor.executemany(sql, params)`",
  "Wrap each run in one transaction and roll back on error",
  "Run the script twice and confirm the row count does not change",
  "Log the number of read, rejected and loaded rows"
 ]
}
```

## Expected output

- `parse_orders` returns 3 clean rows from the sample CSV
- `staging_orders` holds 623 orders with a total of 15521038.96
- `clean_orders` holds 620 orders once the 3 duplicates are gone
- Running the load twice leaves the row count unchanged

## Common mistakes

- Building SQL with f-strings. This breaks on quotes and opens the door to SQL injection.
- Casting blank strings to numbers, which raises in Python and in PostgreSQL.
- Deduplicating on the id only. Business duplicates have new ids.
- Loading without a primary key, so a retry silently doubles the data.

## Interview discussion questions

### How do you make a CSV load idempotent?
Give the target a natural or business key. Then load with `INSERT … ON CONFLICT DO NOTHING` (or `DO UPDATE`), or delete-and-insert the batch inside one transaction.

### Where should bad rows go?
Write them to a reject file or table together with the reason, and count them. Silently dropping them hides upstream problems.

### Why stage the data first?
A staging table separates loading from transforming. You can re-run transformations without re-reading the source, and you can reconcile counts at each step.

## Summary

You parsed a messy CSV, loaded a typed staging table, removed business duplicates and made the load safe to retry. This load–clean–reconcile loop is the core of every batch ETL job.
