---
title: Common Table Expressions (WITH)
slug: cte
category: ctes
difficulty: Intermediate
description: Learn SQL CTEs with WITH clauses in PostgreSQL - name a subquery, read it like a variable and break complex queries into clear steps.
prerequisites: [select, group-by]
related: [multiple-ctes, recursive-cte, cte-vs-subquery, scalar-subqueries]
questions: [19, 20, 21, 22, 23]
patterns: [top-n-per-group, latest-record-per-group]
guides: [cte]
minutes: 8
version: 1
---

## Introduction

A Common Table Expression (CTE) names a query so you can use it later in the same statement. It turns a nested query into a sequence of readable steps.

## Definition

A CTE is a temporary named result set defined with `WITH name AS (query)`. It exists only for the single statement that follows it.

## Why it matters

- Long analytics queries become top-to-bottom steps instead of nested subqueries.
- You can reference the same intermediate result more than once.
- Interviewers expect CTEs for "aggregate, then filter or rank" problems.

## How it works

1. PostgreSQL evaluates the query inside `WITH`, either inline or as a materialized result.
2. The main query reads the CTE as if it were a table.
3. When the statement ends, the CTE is gone. Nothing is stored.

## Syntax

```sql-syntax
WITH cte_name (optional_col1, optional_col2) AS (
    SELECT ...
)
SELECT ...
FROM cte_name;
```

## Simple examples

Revenue per customer as a named step:

```sql
WITH customer_revenue AS (
    SELECT o.customer_id,
           SUM(od.unit_price * od.quantity * (1 - od.discount)) AS revenue
    FROM orders o
    JOIN order_details od ON od.order_id = o.order_id
    GROUP BY o.customer_id
)
SELECT customer_id, ROUND(revenue::numeric, 2) AS revenue
FROM customer_revenue
ORDER BY revenue DESC
LIMIT 5;
```

Column names can also be listed after the CTE name:

```sql
WITH order_counts (customer_id, n_orders) AS (
    SELECT customer_id, COUNT(*) FROM orders GROUP BY customer_id
)
SELECT * FROM order_counts WHERE n_orders >= 3 ORDER BY n_orders DESC;
```

## Intermediate examples

Filter on an aggregate compared with an overall average. The CTE is read twice:

```sql
WITH customer_revenue AS (
    SELECT o.customer_id,
           SUM(od.unit_price * od.quantity * (1 - od.discount)) AS revenue
    FROM orders o
    JOIN order_details od ON od.order_id = o.order_id
    GROUP BY o.customer_id
)
SELECT customer_id, ROUND(revenue::numeric, 2) AS revenue
FROM customer_revenue
WHERE revenue > (SELECT AVG(revenue) FROM customer_revenue)
ORDER BY revenue DESC;
```

## Advanced examples

CTE plus a window function: the latest order per customer.

```sql
WITH ranked AS (
    SELECT customer_id, order_id, order_date,
           ROW_NUMBER() OVER (PARTITION BY customer_id ORDER BY order_date DESC, order_id DESC) AS rn
    FROM orders
)
SELECT customer_id, order_id, order_date
FROM ranked
WHERE rn = 1
ORDER BY customer_id
LIMIT 10;
```

A data-modifying CTE (PostgreSQL). Wrap it in a transaction when testing:

```sql
WITH raised AS (
    UPDATE products
    SET unit_price = unit_price * 1.10
    WHERE category_id = 1
    RETURNING product_id, unit_price
)
SELECT COUNT(*) AS products_raised FROM raised;
```

## Real-world scenarios

- KPI reports: compute per-entity metrics in a CTE, then compare to a benchmark.
- Top-N per group: rank in a CTE, filter `rn <= N` outside.
- Cleanup scripts: `DELETE ... RETURNING` inside a CTE to log what was removed.

## PostgreSQL specifics

- Since PostgreSQL 12, a non-recursive CTE that is referenced once and has no side effects is inlined into the main query. Before 12, CTEs were always materialized ("optimization fence").
- Force behaviour with `WITH x AS MATERIALIZED (...)` or `AS NOT MATERIALIZED (...)`.
- PostgreSQL allows `INSERT`, `UPDATE` and `DELETE` inside `WITH`. Standard SQL and many other databases do not.

## Visual explanation

```text
WITH customer_revenue AS ( ...GROUP BY... )   -- step 1: build named result
     |
     v
SELECT ... FROM customer_revenue              -- step 2: query it like a table
WHERE revenue > (SELECT AVG(...) FROM customer_revenue)
```

## Common mistakes

- Putting a semicolon between the CTE and the main query. They form one statement.
- Expecting the CTE to exist in the next statement. Use a view or temporary table for that.
- Forgetting `ORDER BY` in the outer query. Ordering inside a CTE does not guarantee output order.
- Referencing a CTE before it is defined in a multi-CTE chain.

## Performance

- In PostgreSQL 12+, simple CTEs perform like the equivalent subquery.
- A CTE referenced several times is materialized by default. This can help (computed once) or hurt (no predicate push-down, no index use on the result).
- Check with `EXPLAIN`. Look for a `CTE Scan` node to see materialization.

## Interview questions

### What is a CTE and why use one?

A named, statement-scoped result set defined with `WITH`. It improves readability and lets you reuse an intermediate result.

### Is a CTE stored anywhere?

No. It lives only for the duration of one statement. Use a view or temporary table to persist it.

### Is a CTE slower than a subquery?

In PostgreSQL 12+, usually not: single-use CTEs are inlined. Before 12, CTEs were always materialized and could block optimizations.

### What does MATERIALIZED do?

It forces PostgreSQL to compute the CTE once and store the result, instead of inlining it.

## Quick revision

- `WITH name AS (query) SELECT ... FROM name`.
- Scope: one statement only.
- Can be referenced multiple times in the main query.
- PostgreSQL 12+ inlines single-use, side-effect-free CTEs.
- `AS MATERIALIZED` / `AS NOT MATERIALIZED` override the planner.
- Outer `ORDER BY` controls final order.
