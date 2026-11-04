---
title: Conditional aggregation
slug: conditional-aggregation
category: aggregations
difficulty: Intermediate
description: Compute several filtered aggregates in one pass with SUM(CASE ...) and FILTER. Build pivot reports in PostgreSQL.
prerequisites: [group-by, case, sum]
related: [count-case-when, filter-clause, having, union-all]
questions: [86, 92, 93, 97, 130, 131]
patterns: [conditional-aggregation, pivot-report]
guides: [conditional-aggregation-pivot, pivot-rows-to-columns]
minutes: 9
version: 1
---

## Introduction

Plain `GROUP BY` gives one aggregate per group. Conditional aggregation gives several aggregates per group, each counting or summing only the rows that match its own condition. It is the standard way to pivot rows into columns.

## Definition

Conditional aggregation wraps a condition inside an aggregate, for example `SUM(CASE WHEN cond THEN x ELSE 0 END)` or `SUM(x) FILTER (WHERE cond)`. Each aggregate sees only the rows that satisfy its condition.

## Why it matters

- One scan instead of several queries joined together.
- Turns "status per row" into "one column per status".
- Common interview task: "show 1997 and 1998 revenue side by side".

## How it works

1. `GROUP BY` forms groups as usual.
2. For each row, the `CASE` returns the value or 0/NULL.
3. The aggregate adds up only the values that passed.

Aggregates skip NULLs, so `CASE WHEN cond THEN x END` (no `ELSE`) also works for `SUM`, `AVG`, `COUNT`, `MIN` and `MAX`.

## Syntax

```sql-syntax
SELECT group_col,
       SUM(CASE WHEN condition_a THEN value ELSE 0 END) AS a_total,
       COUNT(*) FILTER (WHERE condition_b)              AS b_count
FROM table_name
GROUP BY group_col;
```

## Simple examples

Orders per year, as two columns:

```sql
SELECT SUM(CASE WHEN EXTRACT(YEAR FROM order_date) = 1997 THEN 1 ELSE 0 END) AS orders_1997,
       SUM(CASE WHEN EXTRACT(YEAR FROM order_date) = 1998 THEN 1 ELSE 0 END) AS orders_1998
FROM orders;
```

Discontinued vs active products per category:

```sql
SELECT category_id,
       SUM(CASE WHEN discontinued THEN 1 ELSE 0 END)     AS discontinued,
       SUM(CASE WHEN NOT discontinued THEN 1 ELSE 0 END) AS active
FROM products
GROUP BY category_id
ORDER BY category_id;
```

## Intermediate examples

Shipped vs unshipped orders per employee:

```sql
SELECT employee_id,
       COUNT(*)                                             AS total,
       SUM(CASE WHEN shipped_date IS NOT NULL THEN 1 ELSE 0 END) AS shipped,
       SUM(CASE WHEN shipped_date IS NULL THEN 1 ELSE 0 END)     AS unshipped
FROM orders
WHERE employee_id IS NOT NULL
GROUP BY employee_id
ORDER BY employee_id;
```

Revenue by category, pivoted by year:

```sql
SELECT c.category_name,
       ROUND(SUM(CASE WHEN EXTRACT(YEAR FROM o.order_date) = 1997
                      THEN od.unit_price * od.quantity * (1 - od.discount) ELSE 0 END)::numeric, 2) AS rev_1997,
       ROUND(SUM(CASE WHEN EXTRACT(YEAR FROM o.order_date) = 1998
                      THEN od.unit_price * od.quantity * (1 - od.discount) ELSE 0 END)::numeric, 2) AS rev_1998
FROM order_details od
JOIN orders o     ON o.order_id = od.order_id
JOIN products p   ON p.product_id = od.product_id
JOIN categories c ON c.category_id = p.category_id
GROUP BY c.category_name
ORDER BY c.category_name;
```

## Advanced examples

Combine sources with `UNION ALL`, then pivot. Countries with more customers than suppliers and employees combined:

```sql
WITH entities AS (
  SELECT country, 'customer' AS kind FROM customers
  UNION ALL
  SELECT country, 'supplier' FROM suppliers
  UNION ALL
  SELECT country, 'employee' FROM employees
)
SELECT country,
       SUM(CASE WHEN kind = 'customer' THEN 1 ELSE 0 END) AS customers,
       SUM(CASE WHEN kind = 'supplier' THEN 1 ELSE 0 END) AS suppliers,
       SUM(CASE WHEN kind = 'employee' THEN 1 ELSE 0 END) AS employees
FROM entities
GROUP BY country
HAVING SUM(CASE WHEN kind = 'customer' THEN 1 ELSE 0 END) >
       SUM(CASE WHEN kind <> 'customer' THEN 1 ELSE 0 END)
ORDER BY customers DESC;
```

Ratio from two conditional aggregates, with safe division:

```sql
SELECT ship_via,
       ROUND(100.0 * COUNT(*) FILTER (WHERE shipped_date > required_date)
             / NULLIF(COUNT(*) FILTER (WHERE shipped_date IS NOT NULL), 0), 1) AS pct_late
FROM orders
GROUP BY ship_via
ORDER BY ship_via;
```

## Real-world scenarios

- Status dashboards: open / shipped / cancelled counts per region.
- Finance: revenue per quarter as columns.
- Funnels: users who reached each step, per cohort.
- Comparing this year vs last year in one row.

## PostgreSQL specifics

- PostgreSQL supports the standard `FILTER (WHERE ...)` clause on any aggregate. It is shorter and clearer than `CASE`. MySQL and SQL Server do not support it.
- `SUM` over zero matching rows returns NULL with `FILTER` or with `CASE ... END` (no `ELSE`). Wrap in `COALESCE(..., 0)` if needed.
- PostgreSQL has `crosstab()` in the `tablefunc` extension, but conditional aggregation needs no extension and is easier to read.
- Booleans can be cast: `SUM(discontinued::int)`.

## Visual explanation

```text
order_id | year         CASE year=1997  CASE year=1998
---------+-----             1               0
   1     | 1997             0               1
   2     | 1998   ──▶       1               0      ──SUM──▶  orders_1997 | orders_1998
   3     | 1997                                                   2      |      1
```

## Common mistakes

- Using `COUNT(CASE WHEN cond THEN 1 ELSE 0 END)`. `COUNT` counts the zeros too. Use `SUM`, or drop the `ELSE`.
- Forgetting `ELSE 0` and getting NULL where you expected 0.
- Hard-coding pivot columns and forgetting new values (for example, a new year) appear as new rows, not new columns.
- Filtering in `WHERE` when you meant to filter one column only. `WHERE` removes the row from every aggregate.

## Performance

- One pass over the data, versus one pass per subquery for the join-of-aggregates approach.
- Push conditions that apply to every column into `WHERE` so fewer rows are scanned.
- `FILTER` and `CASE` have about the same cost in PostgreSQL.

## Interview questions

### How do you pivot rows into columns without PIVOT?

Group by the row key and write one `SUM(CASE WHEN pivot_col = 'X' THEN value END)` per output column. In PostgreSQL, `FILTER (WHERE ...)` does the same.

### Why is COUNT(CASE WHEN x THEN 1 ELSE 0 END) wrong?

`COUNT` counts every non-NULL value, and 0 is not NULL. It returns the total row count. Use `SUM` or remove the `ELSE`.

### What is the difference between filtering in WHERE and inside the aggregate?

`WHERE` removes rows from every aggregate. A conditional aggregate filters only its own column.

### Can you use conditional aggregates in HAVING?

Yes. Repeat the expression in `HAVING`, for example `HAVING SUM(CASE WHEN ... END) > 5`.

## Quick revision

- Pattern: `SUM(CASE WHEN cond THEN x ELSE 0 END)`.
- PostgreSQL: `SUM(x) FILTER (WHERE cond)`.
- Count with `SUM(CASE ... 1 ELSE 0)` or `COUNT(*) FILTER`, never `COUNT(... ELSE 0)`.
- One scan, many metrics.
- `WHERE` filters all columns; the condition filters one.
- Use `COALESCE` when an empty group should show 0.
