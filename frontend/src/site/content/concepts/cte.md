---
slug: cte
title: SQL CTE (WITH Clause) Explained with Examples
description: Learn SQL CTEs (WITH clause) with Northwind examples: syntax, chaining multiple CTEs, CTE vs subquery, top-N per group, and mistakes interviewers look for.
keywords: sql cte, with clause sql, common table expression, cte vs subquery, multiple ctes
questions: 19, 20, 21, 22, 23, 24, 40, 86
related: correlated-subquery, group-by-having, aggregate-functions
---

A common table expression (CTE) is a named, temporary result set defined with `WITH` at the top of a query and referenced like a table in the query that follows. CTEs let you break a complex question into readable steps: aggregate first, then filter, rank, or join. They exist only for the duration of that single statement.

## Syntax

```sql
WITH step_one AS (
    SELECT ...
),
step_two AS (
    SELECT ... FROM step_one ...
)
SELECT ...
FROM step_two;
```

Separate multiple CTEs with commas; use `WITH` only once. Later CTEs may reference earlier ones.

## Example

**Business question:** Who is the top employee by net revenue, including ties?

```sql
WITH line_revenue AS (
    SELECT o.employee_id,
           od.unit_price * od.quantity * (1 - od.discount) AS revenue
    FROM orders o
    JOIN order_details od ON od.order_id = o.order_id
),
employee_revenue AS (
    SELECT employee_id, SUM(revenue) AS total_revenue
    FROM line_revenue
    GROUP BY employee_id
),
ranked AS (
    SELECT employee_id, total_revenue,
           RANK() OVER (ORDER BY total_revenue DESC) AS rnk
    FROM employee_revenue
)
SELECT e.employee_id,
       e.first_name || ' ' || e.last_name AS employee_name,
       ROUND(r.total_revenue::numeric, 2) AS total_revenue
FROM ranked r
JOIN employees e ON e.employee_id = r.employee_id
WHERE r.rnk = 1;
```

Illustrative result:

| employee_id | employee_name | total_revenue |
|---|---|---|
| 6 | Michael Suyama | 32276.55 |

## How it works

Each CTE is evaluated as if it were an inline view. Since PostgreSQL 12, a CTE that is referenced once and has no side effects is usually inlined into the main query, so it costs no more than a subquery. Add `AS MATERIALIZED` to force it to compute once and be reused, or `AS NOT MATERIALIZED` to force inlining.

CTEs shine in three interview patterns:

1. **Aggregate, then compare to the aggregate's average.** Build per-customer revenue once, then reference it twice: once for rows and once for `(SELECT AVG(...) FROM cte)`.
2. **Top N per group.** Rank inside a CTE with `RANK() OVER (PARTITION BY ...)`, then filter `rnk = 1` outside. You cannot filter a window function in `WHERE` at the same level.
3. **Two-level aggregation.** Total each order, then average the order totals per customer.

Top product per category:

```sql
WITH product_revenue AS (
    SELECT p.category_id, p.product_name,
           SUM(od.unit_price * od.quantity * (1 - od.discount)) AS revenue
    FROM products p
    JOIN order_details od ON od.product_id = p.product_id
    GROUP BY p.category_id, p.product_id, p.product_name
),
ranked AS (
    SELECT *, RANK() OVER (PARTITION BY category_id ORDER BY revenue DESC) AS rnk
    FROM product_revenue
)
SELECT c.category_name, r.product_name, ROUND(r.revenue::numeric, 2) AS revenue
FROM ranked r
JOIN categories c ON c.category_id = r.category_id
WHERE r.rnk = 1
ORDER BY c.category_name;
```

`WITH RECURSIVE` is a separate form for hierarchies, such as walking the `employees.reports_to` chain from the top manager downward.

## Common mistakes

- **Repeating `WITH`.** `WITH a AS (...) WITH b AS (...)` is a syntax error. Use one `WITH` and commas.
- **Losing the join key.** A recorded mistake on this site: a CTE that computed a global `SUM` without keeping `order_id` or `customer_id` left nothing to join or group on. Keep the key at the grain you need.
- **Using `LIMIT 1` for "the top".** It silently drops ties. Use `RANK()` and filter `rnk = 1`.
- **Filtering a window function in `WHERE`.** `WHERE RANK() OVER (...) = 1` is not allowed. Compute the rank in a CTE first.
- **Wrong set operator inside a counting CTE.** When stacking counts or rows from several tables with a CTE, use `UNION ALL`; `UNION` can merge identical rows and corrupt counts.
- **Trailing comma before the main `SELECT`.** The last CTE has no comma after its closing parenthesis.

## When to use it vs alternatives

| Option | Choose when |
|---|---|
| CTE | Multiple steps, a result referenced more than once, or readability matters |
| Subquery / derived table | A small, one-off step used once |
| Correlated subquery | A per-row comparison with its own group |
| Temporary table | Results must persist across several statements or need indexes |
| View | The logic is reused across many queries |

In interviews, CTEs are usually preferred for clarity: each step can be named for what it means, such as `customer_revenue`.

## Interview questions

### What is the difference between a CTE and a subquery?
Both produce a temporary result set. A CTE is named at the top with `WITH`, can be referenced multiple times, and can be recursive. A subquery is written inline and used once. In PostgreSQL 12+ simple CTEs are inlined, so performance is usually similar.

### Can you reference one CTE from another?
Yes. CTEs in the same `WITH` list are evaluated in order, and each one can reference any CTE defined before it. This lets you chain steps like line revenue, then employee totals, then ranking.

### How do you get the top record per group with ties?
Compute a rank with `RANK() OVER (PARTITION BY group ORDER BY metric DESC)` in a CTE, then select rows where the rank is 1. `RANK` keeps all tied winners, while `ROW_NUMBER` picks exactly one arbitrarily.

### Is a CTE materialized in PostgreSQL?
Since PostgreSQL 12, a non-recursive, side-effect-free CTE referenced once is inlined by default. CTEs referenced more than once are materialized. You can override this with `AS MATERIALIZED` or `AS NOT MATERIALIZED`.

## Practice

Practice this pattern with the questions below.
