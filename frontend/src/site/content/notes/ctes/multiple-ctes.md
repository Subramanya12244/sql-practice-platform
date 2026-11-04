---
title: Multiple CTEs
slug: multiple-ctes
category: ctes
difficulty: Intermediate
description: Chain multiple CTEs in one WITH clause to build SQL queries step by step, where each CTE can read the ones defined before it.
prerequisites: [cte, group-by]
related: [cte, recursive-cte, cte-vs-subquery, cross-join]
questions: [19, 21, 22, 24, 86]
patterns: [top-n-per-group, month-over-month-growth]
guides: [cte]
minutes: 7
version: 1
---

## Introduction

One `WITH` clause can define several CTEs separated by commas. Each one can use the CTEs above it. This is the cleanest way to write multi-step analytics.

## Definition

Multiple CTEs are a comma-separated list of `name AS (query)` entries after a single `WITH` keyword. Later CTEs may reference earlier ones.

## Why it matters

- Each step has one job: aggregate, compute a benchmark, rank, filter.
- Easy to debug: run the chain up to any step with `SELECT * FROM step_n`.
- Common interview shape: "revenue per X, then average, then those above average".

## How it works

1. Write `WITH` once.
2. Define CTEs in dependency order, separated by commas.
3. The final `SELECT` can read any of them.

## Syntax

```sql-syntax
WITH step1 AS (
    SELECT ...
),
step2 AS (
    SELECT ... FROM step1
),
step3 AS (
    SELECT ... FROM step2 JOIN step1 ON ...
)
SELECT ... FROM step3;
```

## Simple examples

Two independent CTEs joined in the final query:

```sql
WITH orders_per_employee AS (
    SELECT employee_id, COUNT(*) AS n_orders
    FROM orders
    WHERE employee_id IS NOT NULL
    GROUP BY employee_id
),
employee_names AS (
    SELECT employee_id, first_name || ' ' || last_name AS full_name
    FROM employees
)
SELECT n.full_name, o.n_orders
FROM orders_per_employee o
JOIN employee_names n ON n.employee_id = o.employee_id
ORDER BY o.n_orders DESC;
```

## Intermediate examples

Chained: per-employee revenue, then the average, then those above it.

```sql
WITH employee_revenue AS (
    SELECT o.employee_id,
           SUM(od.unit_price * od.quantity * (1 - od.discount)) AS revenue
    FROM orders o
    JOIN order_details od ON od.order_id = o.order_id
    WHERE o.employee_id IS NOT NULL
    GROUP BY o.employee_id
),
avg_revenue AS (
    SELECT AVG(revenue) AS avg_rev FROM employee_revenue
)
SELECT e.employee_id, ROUND(e.revenue::numeric, 2) AS revenue,
       ROUND(a.avg_rev::numeric, 2) AS avg_rev
FROM employee_revenue e
CROSS JOIN avg_revenue a
WHERE e.revenue > a.avg_rev
ORDER BY e.revenue DESC;
```

## Advanced examples

Tie-safe top employee with three CTEs:

```sql
WITH employee_revenue AS (
    SELECT o.employee_id,
           SUM(od.unit_price * od.quantity * (1 - od.discount)) AS revenue
    FROM orders o
    JOIN order_details od ON od.order_id = o.order_id
    WHERE o.employee_id IS NOT NULL
    GROUP BY o.employee_id
),
max_revenue AS (
    SELECT MAX(revenue) AS top_rev FROM employee_revenue
),
top_employees AS (
    SELECT r.employee_id, r.revenue
    FROM employee_revenue r
    JOIN max_revenue m ON r.revenue = m.top_rev
)
SELECT e.first_name, e.last_name, ROUND(t.revenue::numeric, 2) AS revenue
FROM top_employees t
JOIN employees e ON e.employee_id = t.employee_id;
```

Monthly revenue, then month-over-month change:

```sql
WITH monthly AS (
    SELECT DATE_TRUNC('month', o.order_date)::date AS month,
           SUM(od.unit_price * od.quantity * (1 - od.discount)) AS revenue
    FROM orders o
    JOIN order_details od ON od.order_id = o.order_id
    GROUP BY 1
),
with_prev AS (
    SELECT month, revenue, LAG(revenue) OVER (ORDER BY month) AS prev_revenue
    FROM monthly
)
SELECT month, ROUND(revenue::numeric, 2) AS revenue,
       ROUND((100 * (revenue - prev_revenue) / NULLIF(prev_revenue, 0))::numeric, 1) AS pct_change
FROM with_prev
ORDER BY month
LIMIT 6;
```

## Real-world scenarios

- Dashboards: base facts, then metrics, then comparisons.
- Funnel steps: one CTE per stage, joined at the end.
- Tie-safe "winner" queries: aggregate, find max, join back.

## PostgreSQL specifics

- A CTE referenced more than once is materialized by default in PostgreSQL 12+. Single-use CTEs are inlined.
- Each CTE can carry its own `MATERIALIZED` or `NOT MATERIALIZED` hint.
- All CTEs see the same snapshot of the data.

## Visual explanation

```text
employee_revenue --> avg_revenue
       |                 |
       +-------+---------+
               v
      final SELECT (revenue > avg_rev)
```

## Common mistakes

- Writing `WITH` before every CTE. Use `WITH` once, then commas.
- A trailing comma after the last CTE.
- Referencing a CTE defined later in the list (non-recursive CTEs only see earlier ones).
- Over-splitting trivial logic into many CTEs that add noise.

## Performance

- Multiple references to one CTE cause materialization. Fine for small aggregates, costly for large row sets that need index use.
- Filter as early as possible, in the first CTE, to shrink everything downstream.
- Use `EXPLAIN ANALYZE` to see `CTE Scan` nodes and their row counts.

## Interview questions

### How do you define more than one CTE?

One `WITH`, then `name AS (...)` entries separated by commas.

### Can a CTE reference another CTE?

Yes, any CTE defined earlier in the same `WITH` list.

### How do you compare each row to an overall average with CTEs?

Aggregate per entity in one CTE, compute `AVG` over it in a second CTE, then `CROSS JOIN` the one-row result and filter.

### How do you return all ties for the top value?

Compute `MAX` in a CTE and join back on equality, or use `RANK() = 1`. Avoid `LIMIT 1`, which drops ties.

## Quick revision

- One `WITH`, comma-separated CTEs.
- Order matters: a CTE sees only earlier CTEs.
- Debug by selecting from intermediate steps.
- One-row benchmark CTE plus `CROSS JOIN` is a common pattern.
- Join back on `MAX` for tie-safe winners.
- No trailing comma before the final `SELECT`.
