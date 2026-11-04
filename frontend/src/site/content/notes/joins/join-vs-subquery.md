---
title: JOIN vs subquery
slug: join-vs-subquery
category: joins
difficulty: Advanced
description: When to use a JOIN, IN, EXISTS or a scalar subquery in SQL - result shape, duplicates, NULL safety and how PostgreSQL plans each form.
prerequisites: [inner-join, left-join, scalar-subqueries]
related: [exists-not-exists, in-not-in, correlated-subqueries, cte-vs-subquery, join-cardinality]
questions: [6, 15, 16, 18, 28, 29]
patterns: [anti-join, customers-without-orders]
guides: [exists-vs-in, correlated-subquery]
minutes: 8
version: 1
---

## Introduction

Many questions can be answered with either a join or a subquery. The right choice depends on what you need back: columns from the other table, or only a yes/no test.

## Definition

- **JOIN**: combines rows; columns from both tables are available; one-to-many matches repeat rows.
- **Semi-join** (`EXISTS`, `IN`): keeps rows that have at least one match; never duplicates.
- **Anti-join** (`NOT EXISTS`, `LEFT JOIN ... IS NULL`): keeps rows with no match.
- **Scalar subquery**: returns one value, usable as a column or in a comparison.

## Why it matters

Interviewers ask "rewrite this with a join" or "why did your join return duplicates?". Knowing the semantics avoids wrong answers; knowing the planner avoids myths about speed.

## How it works

PostgreSQL rewrites `IN (subquery)` and `EXISTS` into semi-joins, and `NOT EXISTS` into anti-joins, so they often plan like joins. `NOT IN` cannot become an anti-join because of NULL semantics. Correlated scalar subqueries may run once per outer row.

## Syntax

```sql-syntax
-- join: need columns from b
SELECT a.*, b.col FROM a JOIN b ON b.a_id = a.id;

-- semi-join: only test existence
SELECT a.* FROM a WHERE EXISTS (SELECT 1 FROM b WHERE b.a_id = a.id);

-- anti-join
SELECT a.* FROM a WHERE NOT EXISTS (SELECT 1 FROM b WHERE b.a_id = a.id);

-- scalar subquery
SELECT a.*, (SELECT MAX(b.col) FROM b WHERE b.a_id = a.id) FROM a;
```

## Simple examples

Customers who ordered at least once. A join repeats each customer per order:

```sql
SELECT COUNT(*) AS join_rows,
       COUNT(DISTINCT c.customer_id) AS distinct_customers
FROM customers c
JOIN orders o ON o.customer_id = c.customer_id;
```

`EXISTS` returns each customer once, no `DISTINCT` needed:

```sql
SELECT c.customer_id, c.company_name
FROM customers c
WHERE EXISTS (SELECT 1 FROM orders o WHERE o.customer_id = c.customer_id)
ORDER BY c.customer_id
LIMIT 5;
```

## Intermediate examples

Anti-join, two equivalent forms:

```sql
SELECT p.product_id, p.product_name
FROM products p
WHERE NOT EXISTS (SELECT 1 FROM order_details od WHERE od.product_id = p.product_id);
```

```sql
SELECT p.product_id, p.product_name
FROM products p
LEFT JOIN order_details od ON od.product_id = p.product_id
WHERE od.product_id IS NULL;
```

Comparing with an overall aggregate: a scalar subquery is the simplest form.

```sql
SELECT product_name, unit_price
FROM products
WHERE unit_price > (SELECT AVG(unit_price) FROM products)
ORDER BY unit_price DESC
LIMIT 5;
```

## Advanced examples

Latest order date per customer: correlated scalar subquery vs join to an aggregate. Same result; the join form aggregates once.

```sql
SELECT c.customer_id,
       (SELECT MAX(o.order_date) FROM orders o WHERE o.customer_id = c.customer_id) AS last_order
FROM customers c
ORDER BY c.customer_id
LIMIT 5;
```

```sql
SELECT c.customer_id, lo.last_order
FROM customers c
LEFT JOIN (SELECT customer_id, MAX(order_date) AS last_order
           FROM orders GROUP BY customer_id) lo
  ON lo.customer_id = c.customer_id
ORDER BY c.customer_id
LIMIT 5;
```

Customers whose revenue is above the average customer revenue: a CTE plus a scalar subquery.

```sql
WITH rev AS (
  SELECT o.customer_id, SUM(od.unit_price * od.quantity * (1 - od.discount)) AS revenue
  FROM orders o
  JOIN order_details od ON od.order_id = o.order_id
  GROUP BY o.customer_id
)
SELECT customer_id, ROUND(revenue::numeric, 2) AS revenue
FROM rev
WHERE revenue > (SELECT AVG(revenue) FROM rev)
ORDER BY revenue DESC
LIMIT 5;
```

## Real-world scenarios

- Filtering by membership ("customers in a campaign list"): `EXISTS`.
- Showing details from the related table: `JOIN`.
- Missing records: `NOT EXISTS`.
- Benchmarks (vs average, vs max): scalar subquery or window function.

## PostgreSQL specifics

- `IN`/`EXISTS` subqueries are flattened into semi-joins; `NOT EXISTS` into anti-joins.
- `NOT IN (subquery)` returns no rows if the subquery yields any NULL and is planned less efficiently.
- A scalar subquery that returns more than one row raises "more than one row returned by a subquery used as an expression".
- Since PostgreSQL 12, CTEs referenced once are inlined unless marked `MATERIALIZED`.

## Visual explanation

| need | best form | duplicates? |
|---|---|---|
| columns from both tables | `JOIN` | yes, per match |
| "has at least one" | `EXISTS` / `IN` | no |
| "has none" | `NOT EXISTS` / `LEFT JOIN ... IS NULL` | no |
| one value per row | scalar subquery / join to aggregate | no |

## Common mistakes

- Using a join for an existence test, then `DISTINCT` to remove duplicates.
- `NOT IN` against a nullable column.
- Correlated scalar subqueries over large tables when a single grouped join would do.
- Believing "subqueries are always slower": the planner often produces the same plan.

## Performance

Semi- and anti-joins stop at the first match, so they can beat a join plus `DISTINCT`. A correlated subquery may run per outer row; with an index on the correlation column this is fine for small outer sets, but a grouped join scales better for large ones. Compare with `EXPLAIN ANALYZE`.

## Interview questions

### When should you use EXISTS instead of JOIN?

When you only need to test that a related row exists. `EXISTS` never duplicates outer rows and can stop at the first match.

### Is a subquery slower than a join?

Not inherently. PostgreSQL often transforms `IN`/`EXISTS` into the same semi-join plan. Check `EXPLAIN`.

### Why prefer NOT EXISTS over NOT IN?

`NOT IN` returns no rows if the subquery contains a NULL. `NOT EXISTS` handles NULLs correctly and plans as an anti-join.

### How do you rewrite a correlated scalar subquery as a join?

Aggregate the inner table by the correlation key in a derived table, then `LEFT JOIN` it on that key.

## Quick revision

- Need columns from the other table: `JOIN`.
- Need only existence: `EXISTS` / `IN` (semi-join).
- Need absence: `NOT EXISTS` or `LEFT JOIN ... IS NULL`.
- Avoid `NOT IN` with nullable columns.
- Correlated scalar subquery = join to a grouped derived table.
- Measure with `EXPLAIN ANALYZE`, do not guess.
