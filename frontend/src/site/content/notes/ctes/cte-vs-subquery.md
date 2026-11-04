---
title: CTE vs Subquery
slug: cte-vs-subquery
category: ctes
difficulty: Intermediate
description: Compare CTEs and subqueries in PostgreSQL - readability, reuse, materialization and performance - and know when to pick each.
prerequisites: [cte, scalar-subqueries]
related: [cte, multiple-ctes, scalar-subqueries, correlated-subqueries, join-vs-subquery]
questions: [6, 15, 16, 19, 21]
patterns: [second-highest, top-n-per-group]
guides: [cte, correlated-subquery]
minutes: 7
version: 1
---

## Introduction

Most CTEs can be rewritten as subqueries and vice versa. The choice is mostly about readability and reuse, with some PostgreSQL-specific performance nuances.

## Definition

- **Subquery:** a query nested inside another query's `SELECT`, `FROM`, `WHERE` or `HAVING`.
- **CTE:** a query named in a `WITH` clause and referenced by the main statement.

## Why it matters

- Interviewers ask "Which would you use and why?".
- Picking the right form keeps complex queries maintainable.
- In older PostgreSQL versions, the choice changed the execution plan.

## How it works

- A derived table (`FROM (subquery) alias`) and a single-use CTE produce the same plan in PostgreSQL 12+.
- A CTE referenced twice is computed once and reused. Two identical subqueries are planned separately.
- Correlated subqueries depend on the outer row. A CTE cannot be correlated with the outer query.

## Syntax

```sql-syntax
-- Derived-table subquery
SELECT ... FROM (SELECT ... ) AS t WHERE ...;

-- Same logic as a CTE
WITH t AS (SELECT ...)
SELECT ... FROM t WHERE ...;
```

## Simple examples

Customers with at least 3 orders, as a subquery:

```sql
SELECT customer_id, n_orders
FROM (
    SELECT customer_id, COUNT(*) AS n_orders
    FROM orders
    GROUP BY customer_id
) t
WHERE n_orders >= 3
ORDER BY n_orders DESC;
```

Same as a CTE:

```sql
WITH t AS (
    SELECT customer_id, COUNT(*) AS n_orders
    FROM orders
    GROUP BY customer_id
)
SELECT customer_id, n_orders
FROM t
WHERE n_orders >= 3
ORDER BY n_orders DESC;
```

## Intermediate examples

Reuse favours a CTE. The subquery version repeats the aggregation:

```sql
SELECT customer_id, n_orders
FROM (SELECT customer_id, COUNT(*) AS n_orders FROM orders GROUP BY customer_id) t
WHERE n_orders > (
    SELECT AVG(n_orders)
    FROM (SELECT customer_id, COUNT(*) AS n_orders FROM orders GROUP BY customer_id) t2
)
ORDER BY n_orders DESC;
```

```sql
WITH t AS (
    SELECT customer_id, COUNT(*) AS n_orders FROM orders GROUP BY customer_id
)
SELECT customer_id, n_orders
FROM t
WHERE n_orders > (SELECT AVG(n_orders) FROM t)
ORDER BY n_orders DESC;
```

## Advanced examples

Correlated logic needs a subquery: products priced above their own category average.

```sql
SELECT p.product_name, p.category_id, p.unit_price
FROM products p
WHERE p.unit_price > (
    SELECT AVG(p2.unit_price)
    FROM products p2
    WHERE p2.category_id = p.category_id
)
ORDER BY p.category_id, p.unit_price DESC;
```

The CTE equivalent precomputes all averages and joins:

```sql
WITH cat_avg AS (
    SELECT category_id, AVG(unit_price) AS avg_price
    FROM products
    GROUP BY category_id
)
SELECT p.product_name, p.category_id, p.unit_price
FROM products p
JOIN cat_avg c ON c.category_id = p.category_id
WHERE p.unit_price > c.avg_price
ORDER BY p.category_id, p.unit_price DESC;
```

Control materialization explicitly (PostgreSQL 12+):

```sql
WITH t AS NOT MATERIALIZED (
    SELECT order_id, customer_id, order_date FROM orders
)
SELECT * FROM t WHERE order_id = 10248;
```

## Real-world scenarios

- Short one-off filters: an inline `IN (subquery)` or `EXISTS` is clearer.
- Multi-step reports: CTEs read top to bottom.
- Per-row comparisons: correlated subquery or a CTE plus join.
- Recursion: only a CTE (`WITH RECURSIVE`) can do it.

## PostgreSQL specifics

- PostgreSQL 12+ inlines CTEs that are non-recursive, side-effect free and referenced once. Earlier versions always materialized them.
- Multi-referenced CTEs are materialized by default. Use `NOT MATERIALIZED` to allow inlining.
- Data-modifying statements in `WITH` are PostgreSQL-specific and always run exactly once.

## Visual explanation

| Aspect | Subquery | CTE |
| --- | --- | --- |
| Readability for many steps | Nested, inside-out | Linear, top-down |
| Reuse in same statement | Repeat the text | Reference by name |
| Correlated with outer row | Yes | No |
| Recursion | No | `WITH RECURSIVE` |
| PostgreSQL 12+ single use | Same plan | Same plan |

## Common mistakes

- Claiming CTEs are always slower or always faster. In PostgreSQL 12+ it depends on materialization.
- Rewriting a correlated subquery as a CTE without adding the join key.
- Nesting three or more subqueries when a CTE chain would read better.
- Using a CTE when a simple `EXISTS` would be clearest.

## Performance

- Single-use: no difference in PostgreSQL 12+.
- Multi-use: CTE materialization saves recomputation but blocks predicate push-down into the CTE.
- Correlated subqueries may run once per outer row. The planner often rewrites them into joins, but check `EXPLAIN`.

## Interview questions

### What is the main difference between a CTE and a subquery?

A CTE is named and defined before the main query, so it can be reused and read linearly. A subquery is inline and can be correlated with the outer row.

### Are CTEs slower in PostgreSQL?

Not since PostgreSQL 12 for single-use CTEs, which are inlined. Multi-referenced CTEs are materialized, which can help or hurt.

### When must you use a CTE?

For recursion (`WITH RECURSIVE`) and for PostgreSQL data-modifying `WITH` statements.

### When is a subquery the better choice?

For short `IN` or `EXISTS` filters and for correlated, per-row logic.

## Quick revision

- Same result, different readability.
- CTE: named, reusable, top-down, can recurse.
- Subquery: inline, can be correlated.
- PostgreSQL 12+: single-use CTEs are inlined.
- `MATERIALIZED` / `NOT MATERIALIZED` control the plan.
- Verify with `EXPLAIN`, not assumptions.
