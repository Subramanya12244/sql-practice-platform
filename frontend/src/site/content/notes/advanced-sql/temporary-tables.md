---
title: Temporary tables
slug: temporary-tables
category: advanced-sql
difficulty: Intermediate
description: Stage intermediate results in session-scoped tables with CREATE TEMP TABLE, ON COMMIT options and indexes, and compare them with CTEs and views.
prerequisites: [select, cte]
related: [views, cte, indexes, transactions]
questions: [189, 190]
patterns: [remove-duplicates]
guides: [cte]
minutes: 7
version: 1
---

## Introduction

Some jobs need several steps over the same intermediate data: stage it, clean it, join it, report it. A temporary table holds that data for the session without polluting the schema.

## Definition

A temporary table is a real table visible only to the session that created it. It is dropped automatically at session end (or at commit, if requested). In PostgreSQL it lives in a per-session `pg_temp` schema.

## Why it matters

- Break a huge query into debuggable steps.
- Reuse an expensive intermediate result many times.
- Add indexes and statistics to intermediate data, which a CTE cannot have.
- Common in ETL and data-cleaning interviews.

## How it works

- `CREATE TEMP TABLE t AS SELECT ...` or `CREATE TEMP TABLE t (...)` then `INSERT`.
- Name lookup checks `pg_temp` first, so a temp table can shadow a permanent one with the same name.
- `ON COMMIT PRESERVE ROWS` (default) keeps rows until session end; `DELETE ROWS` empties at each commit; `DROP` drops at commit.
- Temp tables are not WAL-logged and are not seen by autovacuum; run `ANALYZE` after loading.

## Syntax

```sql-syntax
CREATE TEMP TABLE tmp_name (
  col type, ...
) [ON COMMIT { PRESERVE ROWS | DELETE ROWS | DROP }];

CREATE TEMP TABLE tmp_name AS SELECT ...;
ANALYZE tmp_name;
DROP TABLE IF EXISTS tmp_name;
```

## Simple examples

Stage customer revenue, then query it:

```sql
CREATE TEMP TABLE tmp_customer_revenue AS
SELECT o.customer_id,
       SUM(od.unit_price * od.quantity * (1 - od.discount)) AS revenue
FROM orders o JOIN order_details od ON od.order_id = o.order_id
GROUP BY o.customer_id;

SELECT customer_id, ROUND(revenue::numeric, 2) AS revenue
FROM tmp_customer_revenue
ORDER BY revenue DESC
LIMIT 5;
```

## Intermediate examples

Reuse one staged result for two questions, with an index and fresh statistics:

```sql
CREATE TEMP TABLE tmp_rev AS
SELECT o.customer_id, c.country,
       SUM(od.unit_price * od.quantity * (1 - od.discount)) AS revenue
FROM orders o
JOIN customers c ON c.customer_id = o.customer_id
JOIN order_details od ON od.order_id = o.order_id
GROUP BY o.customer_id, c.country;
CREATE INDEX ON tmp_rev (country);
ANALYZE tmp_rev;

SELECT country, COUNT(*) AS customers,
       ROUND(SUM(revenue)::numeric, 2) AS revenue,
       ROUND(AVG(revenue)::numeric, 2) AS avg_per_customer
FROM tmp_rev
GROUP BY country
ORDER BY revenue DESC
LIMIT 5;
```

## Advanced examples

Clean-and-load workflow: stage messy input, de-duplicate, then merge into the real table.

```sql
CREATE TEMP TABLE tmp_shippers_in (company_name text, phone text) ON COMMIT DROP;
INSERT INTO tmp_shippers_in VALUES
  ('  Fast Freight ', NULL), ('Fast Freight', NULL), ('Polar Post', NULL);

INSERT INTO shippers (company_name, phone)
SELECT DISTINCT TRIM(company_name), phone
FROM tmp_shippers_in t
WHERE NOT EXISTS (SELECT 1 FROM shippers s WHERE s.company_name = TRIM(t.company_name))
RETURNING shipper_id, company_name;
```

`ON COMMIT DROP` removes the staging table as soon as the transaction commits.

## Real-world scenarios

- ETL staging before upserting into production tables.
- Multi-step analytics scripts where each step is checked.
- Lists of IDs to process in batches.
- Reports that hit the same expensive aggregation several times.

## PostgreSQL specifics

- `TEMP` and `TEMPORARY` are synonyms. Standard SQL distinguishes `GLOBAL` and `LOCAL` temporary tables; PostgreSQL accepts the keywords but ignores the difference.
- SQL Server uses `#tmp` (session) and `##tmp` (global) names; MySQL uses `CREATE TEMPORARY TABLE`.
- Temp tables are unlogged: fast to write, not crash-safe, not replicated.
- Memory for temp tables is controlled by `temp_buffers`.
- Creating many temp tables bloats the system catalogs; reuse or truncate where possible.

## Visual explanation

| Option | Lifetime | Indexable | Visible to |
|---|---|---|---|
| CTE | one statement | no | that statement |
| Temp table | session (or commit) | yes | this session |
| View | permanent | no (query only) | everyone with grants |
| Materialized view | permanent, refreshed | yes | everyone with grants |

## Common mistakes

- Forgetting `ANALYZE`, so the planner guesses row counts badly.
- Expecting another connection (e.g. a connection pool) to see your temp table.
- Using a temp table when one readable CTE would do.
- Shadowing a permanent table by accident with the same name.

## Performance

- Good when an intermediate result is reused or needs an index.
- Unnecessary copying of large data costs I/O; a CTE or subquery may be faster.
- With transaction-mode connection poolers, session-scoped temp tables are unreliable.

## Interview questions

### Temp table vs CTE?

A CTE exists for one statement and cannot be indexed. A temp table persists for the session, can be indexed and analysed, and can be reused across statements.

### Who can see a temp table?

Only the session that created it. Other sessions can create their own with the same name.

### What does ON COMMIT DROP do?

It drops the table when the creating transaction commits, which is handy for one-off staging.

### Why ANALYZE a temp table?

Autovacuum does not process temp tables, so without `ANALYZE` the planner has no statistics for them.

## Quick revision

- Session-private, auto-dropped.
- `CREATE TEMP TABLE ... AS SELECT` for staging.
- `ON COMMIT PRESERVE | DELETE ROWS | DROP`.
- Index + `ANALYZE` after loading.
- Not WAL-logged, not seen by other sessions.
- Prefer CTEs for single-use steps.
