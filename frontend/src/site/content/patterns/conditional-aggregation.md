---
title: Conditional aggregation
slug: conditional-aggregation
category: reshape
difficulty: Intermediate
description: Compute several filtered counts and sums in one pass with SUM(CASE WHEN …) or PostgreSQL's FILTER clause.
questions: [179, 92, 93, 97, 86]
notes: [conditional-aggregation, count-case-when, filter-clause, case]
guides: [conditional-aggregation-pivot]
---

## Problem

Compute several counts or sums with different conditions in one query, such as shipped and unshipped orders per employee.

## When to use it

- Status breakdowns (shipped, late, pending) per entity.
- Ratios such as the share of late orders.
- Avoiding several separate queries or self-joins.

## Solution

```sql
SELECT employee_id,
       COUNT(*) AS orders,
       COUNT(*) FILTER (WHERE shipped_date IS NOT NULL)     AS shipped,
       COUNT(*) FILTER (WHERE shipped_date IS NULL)         AS unshipped,
       COUNT(*) FILTER (WHERE shipped_date > required_date) AS late
FROM orders
GROUP BY employee_id
ORDER BY employee_id NULLS LAST;
```

## Alternatives

Portable `SUM(CASE …)` / `COUNT(CASE …)`, which works in every database:

```sql
SELECT employee_id,
       SUM(CASE WHEN shipped_date IS NOT NULL THEN 1 ELSE 0 END) AS shipped,
       COUNT(CASE WHEN shipped_date > required_date THEN 1 END)  AS late,
       ROUND(AVG(CASE WHEN shipped_date > required_date THEN 1.0 ELSE 0 END) * 100, 1) AS late_pct
FROM orders
GROUP BY employee_id
ORDER BY employee_id NULLS LAST;
```

PostgreSQL also lets you sum a boolean cast to an integer:

```sql
SELECT ship_country,
       SUM((freight > 50)::int) AS heavy_orders,
       COUNT(*) AS orders
FROM orders
GROUP BY ship_country
ORDER BY heavy_orders DESC
LIMIT 5;
```

`FILTER` is standard SQL but only some databases support it (PostgreSQL does). `CASE` works everywhere. `AVG(CASE … 1.0 ELSE 0 END)` gives a ratio directly.

## How it works

Every row passes through `GROUP BY` once. Each aggregate decides per row whether to include it: `FILTER (WHERE …)` skips rows that fail the condition, and `CASE` returns NULL (ignored by `COUNT`) or 0 (adds nothing to `SUM`).

## Execution walkthrough

1. Orders are grouped by `employee_id`. The order with a NULL employee forms its own group.
2. For each row, each `FILTER` condition is checked separately.
3. Each count increases only for rows that pass its condition.
4. One scan produces all the columns.

## Common mistakes

- `COUNT(CASE WHEN … THEN 1 ELSE 0 END)`. `COUNT` counts the zeros too. Use `SUM` with `ELSE 0`, or `COUNT` with no `ELSE`.
- Comparing with NULL: `shipped_date > required_date` is NULL when `shipped_date` is NULL, so the row is not counted. That is usually what you want, but check it.
- Putting the condition in `WHERE`, which removes rows from every column.

## Performance

One table scan for all the metrics, which is much cheaper than one subquery per metric. `FILTER` and `CASE` perform about the same.
