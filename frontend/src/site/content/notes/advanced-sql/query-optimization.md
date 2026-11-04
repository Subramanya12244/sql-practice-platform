---
title: Query optimization
slug: query-optimization
category: advanced-sql
difficulty: Expert
description: Read EXPLAIN plans, write sargable filters, choose joins vs subqueries wisely and avoid common performance traps in PostgreSQL.
prerequisites: [indexes, inner-join, group-by]
related: [indexes, join-vs-subquery, exists-not-exists, cte-vs-subquery, views]
questions: [3, 28, 98, 100, 118]
patterns: [anti-join, top-n-per-group, latest-record-per-group]
guides: [sql-order-of-execution, exists-vs-in]
minutes: 11
version: 1
---

## Introduction

A correct query that takes 40 seconds is still a bug. Optimization means finding where the time goes (the plan) and giving the planner a better option (an index, a rewrite, fresher statistics).

## Definition

Query optimization is the practice of reducing a query's cost (I/O, CPU, memory) without changing its result. PostgreSQL's cost-based planner chooses scan methods, join methods and join order from table statistics; `EXPLAIN` shows the chosen plan.

## Why it matters

- Slow queries block users, hold locks and burn cloud budget.
- The same answer can cost 1000x more written badly.
- Senior interviews ask you to read a plan and explain a fix.

## How it works

1. Measure: `EXPLAIN (ANALYZE, BUFFERS)` runs the query and shows real times and row counts per node.
2. Compare estimated rows vs actual rows. Big gaps mean bad statistics or correlated predicates.
3. Find the expensive node: Seq Scan on a big table with a selective filter, a Nested Loop over many rows, a Sort spilling to disk.
4. Fix: index, sargable rewrite, reduce rows earlier, `ANALYZE`, or rethink the data model.

Plan nodes you should know: Seq Scan, Index Scan, Index Only Scan, Bitmap Heap Scan, Nested Loop, Hash Join, Merge Join, HashAggregate, GroupAggregate, Sort, Limit.

## Syntax

```sql-syntax
EXPLAIN query;                               -- estimated plan only
EXPLAIN (ANALYZE, BUFFERS) query;            -- executes it, real timings
EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON) query;
ANALYZE table_name;                          -- refresh statistics
```

## Simple examples

Estimated plan for a join with aggregation. Costs and the chosen nodes depend on data size, statistics and settings, so your output may differ:

```sql
EXPLAIN
SELECT c.country, COUNT(*) AS orders
FROM customers c
JOIN orders o ON o.customer_id = c.customer_id
GROUP BY c.country;
```

`EXPLAIN ANALYZE` actually runs the statement. For writes, wrap it in a transaction and roll back:

```sql
EXPLAIN (ANALYZE, COSTS OFF, TIMING OFF)
SELECT * FROM orders WHERE customer_id = 'ALFKI';
```

## Intermediate examples

Sargable vs non-sargable filter. Both return the same rows; only the second can use an index on `order_date`:

```sql
SELECT COUNT(*) FROM orders WHERE EXTRACT(YEAR FROM order_date) = 1997;
```

```sql
SELECT COUNT(*) FROM orders
WHERE order_date >= DATE '1997-01-01' AND order_date < DATE '1998-01-01';
```

Anti-join: `NOT EXISTS` is NULL-safe and planned as a Hash Anti Join; `NOT IN` against a nullable column can return nothing:

```sql
SELECT c.customer_id
FROM customers c
WHERE NOT EXISTS (SELECT 1 FROM orders o WHERE o.customer_id = c.customer_id);
```

## Advanced examples

Aggregate before joining to shrink the join input:

```sql
WITH line_rev AS (
  SELECT order_id, SUM(unit_price * quantity * (1 - discount)) AS revenue
  FROM order_details
  GROUP BY order_id
)
SELECT o.customer_id, ROUND(SUM(l.revenue)::numeric, 2) AS revenue
FROM orders o
JOIN line_rev l ON l.order_id = o.order_id
GROUP BY o.customer_id
ORDER BY revenue DESC
LIMIT 5;
```

Top-1 per group: `DISTINCT ON` (PostgreSQL) with a matching index often beats a window function over the whole table:

```sql
CREATE INDEX idx_orders_cust_date ON orders (customer_id, order_date DESC);
SELECT DISTINCT ON (customer_id) customer_id, order_id, order_date
FROM orders
ORDER BY customer_id, order_date DESC
LIMIT 5;
```

Compare estimates to reality per node with machine-readable output:

```sql
EXPLAIN (ANALYZE, FORMAT JSON, TIMING OFF)
SELECT p.category_id, SUM(od.quantity)
FROM order_details od JOIN products p ON p.product_id = od.product_id
GROUP BY p.category_id;
```

Look at `"Plan Rows"` (estimate) vs `"Actual Rows"` in each node.

## Real-world scenarios

- A dashboard query timing out after data grew 10x: plan shows Seq Scan + Sort; add a composite index.
- A report wrong-sized by stale stats after a bulk load: run `ANALYZE`.
- Pagination with `OFFSET 100000`: switch to keyset pagination (`WHERE id > last_id ORDER BY id LIMIT 50`).
- ORM N+1 queries: replace with one join.

## PostgreSQL specifics

- Since PostgreSQL 12, non-recursive CTEs referenced once are inlined; use `MATERIALIZED` / `NOT MATERIALIZED` to force either way.
- `pg_stat_statements` (extension) ranks queries by total time.
- `auto_explain` logs plans of slow queries.
- `work_mem` controls in-memory sorts/hashes per node; spills show as "external merge Disk".
- PostgreSQL has no query hints; you steer with indexes, statistics (`CREATE STATISTICS`) and rewrites. Settings like `enable_seqscan` are for diagnosis only.

## Visual explanation

```text
Read plans bottom-up (innermost first):

Limit
 └─ Sort  (key: revenue DESC)
     └─ HashAggregate  (group: customer_id)
         └─ Hash Join  (o.order_id = l.order_id)
             ├─ Seq Scan on orders o
             └─ Hash
                 └─ Subquery/Aggregate over order_details

Ask at each node: estimated rows ~ actual rows?  where is the time?
```

## Common mistakes

- Optimising from `EXPLAIN` without `ANALYZE`, trusting estimates blindly.
- Running `EXPLAIN ANALYZE` on a `DELETE` outside a transaction: it really deletes.
- `SELECT *` pulling wide rows and preventing index-only scans.
- Functions or casts on indexed columns in `WHERE`.
- `OR` across different columns where `UNION ALL` of two indexed queries would be faster.
- Treating a plan from a 100-row table as representative of production.

## Performance

Checklist, in order:
1. Return fewer rows and columns.
2. Make filters sargable; match indexes to `WHERE` + `ORDER BY`.
3. Keep statistics fresh (`ANALYZE`), raise targets for skewed columns.
4. Prefer `EXISTS`/`NOT EXISTS` for semi/anti-joins.
5. Pre-aggregate before joining large fact tables.
6. Consider materialized views for heavy repeated reports.

## Interview questions

### How do you troubleshoot a slow query?

Get the real plan with `EXPLAIN (ANALYZE, BUFFERS)`, find the most expensive node, compare estimated and actual rows, then add or fix indexes, rewrite non-sargable predicates, or refresh statistics. Re-measure.

### What is a sargable predicate?

One the engine can match against an index: column on one side, constant/parameter on the other, no function on the column. `d >= '1997-01-01'` is sargable; `EXTRACT(YEAR FROM d) = 1997` is not.

### Hash Join vs Nested Loop vs Merge Join?

Nested Loop: good for small outer inputs with an index on the inner side. Hash Join: builds a hash of the smaller input; good for large unsorted equi-joins. Merge Join: both inputs sorted on the key; good when sorted input is already available.

### Why is OFFSET pagination slow?

The engine must produce and discard all skipped rows. Keyset pagination seeks directly with an index.

### EXISTS or IN?

For positive checks PostgreSQL often plans both as a semi-join. For negation prefer `NOT EXISTS`, because `NOT IN` returns no rows if the subquery yields a NULL.

## Quick revision

- Measure with `EXPLAIN (ANALYZE, BUFFERS)`; plan costs vary by environment.
- Estimated vs actual rows reveals bad statistics.
- Sargable filters + matching composite indexes.
- `NOT EXISTS` for anti-joins.
- Aggregate early, select only needed columns.
- Keyset pagination instead of large `OFFSET`.
- `ANALYZE` after bulk loads.
