---
title: FILTER clause
slug: filter-clause
category: aggregations
difficulty: Intermediate
description: Use the standard FILTER (WHERE ...) clause in PostgreSQL to restrict each aggregate to matching rows. Cleaner than CASE.
prerequisites: [count, sum, group-by]
related: [conditional-aggregation, count-case-when, having, over]
questions: [130, 131]
patterns: [conditional-aggregation, pivot-report]
guides: [conditional-aggregation-pivot]
minutes: 6
version: 1
---

## Introduction

`FILTER (WHERE ...)` attaches a condition to a single aggregate. It replaces the `SUM(CASE WHEN ...)` idiom with something shorter and easier to read.

## Definition

`aggregate(expr) FILTER (WHERE condition)` computes the aggregate over only the rows of the group where `condition` is true. It is part of the SQL:2003 standard.

## Why it matters

- Clear intent: the condition sits next to the aggregate.
- No `ELSE 0` vs NULL confusion.
- Works with every aggregate, including `COUNT(DISTINCT ...)`, `STRING_AGG`, `ARRAY_AGG` and window aggregates.

## How it works

For each group, PostgreSQL passes only rows matching the `FILTER` condition into that aggregate. Other aggregates in the same `SELECT` still see all rows. If no rows match, `COUNT` returns 0 and other aggregates return NULL.

## Syntax

```sql-syntax
SELECT group_col,
       COUNT(*)            FILTER (WHERE condition_a) AS a_count,
       SUM(value)          FILTER (WHERE condition_b) AS b_total,
       AVG(value)          FILTER (WHERE condition_c) AS c_avg
FROM table_name
GROUP BY group_col;
```

## Simple examples

```sql
SELECT COUNT(*)                                    AS total,
       COUNT(*) FILTER (WHERE shipped_date IS NULL) AS unshipped,
       COUNT(*) FILTER (WHERE freight > 50)         AS heavy
FROM orders;
```

```sql
SELECT category_id,
       COUNT(*) FILTER (WHERE discontinued)     AS discontinued,
       COUNT(*) FILTER (WHERE NOT discontinued) AS active
FROM products
GROUP BY category_id
ORDER BY category_id;
```

## Intermediate examples

Employee shipping status counts:

```sql
SELECT employee_id,
       COUNT(*) FILTER (WHERE shipped_date IS NULL)            AS pending,
       COUNT(*) FILTER (WHERE shipped_date <= required_date)   AS on_time,
       COUNT(*) FILTER (WHERE shipped_date > required_date)    AS late
FROM orders
WHERE employee_id IS NOT NULL
GROUP BY employee_id
ORDER BY employee_id;
```

Pivot category revenue by year, with `COALESCE` for empty cells:

```sql
SELECT c.category_name,
       COALESCE(ROUND(SUM(od.unit_price * od.quantity * (1 - od.discount))
                FILTER (WHERE EXTRACT(YEAR FROM o.order_date) = 1997)::numeric, 2), 0) AS rev_1997,
       COALESCE(ROUND(SUM(od.unit_price * od.quantity * (1 - od.discount))
                FILTER (WHERE EXTRACT(YEAR FROM o.order_date) = 1998)::numeric, 2), 0) AS rev_1998
FROM order_details od
JOIN orders o     ON o.order_id = od.order_id
JOIN products p   ON p.product_id = od.product_id
JOIN categories c ON c.category_id = p.category_id
GROUP BY c.category_name
ORDER BY c.category_name;
```

## Advanced examples

`FILTER` with `STRING_AGG` and `COUNT(DISTINCT ...)`:

```sql
SELECT category_id,
       COUNT(DISTINCT supplier_id) FILTER (WHERE unit_price > 30)                     AS premium_suppliers,
       STRING_AGG(product_name, ', ' ORDER BY product_name) FILTER (WHERE discontinued) AS discontinued_list
FROM products
GROUP BY category_id
ORDER BY category_id;
```

`FILTER` on a window aggregate: running count of late orders:

```sql
SELECT order_id, order_date,
       COUNT(*) FILTER (WHERE shipped_date > required_date)
         OVER (ORDER BY order_date, order_id) AS late_so_far
FROM orders
ORDER BY order_date, order_id
LIMIT 10;
```

`FILTER` inside `HAVING`:

```sql
SELECT customer_id, COUNT(*) AS orders
FROM orders
GROUP BY customer_id
HAVING COUNT(*) FILTER (WHERE EXTRACT(YEAR FROM order_date) = 1998) >= 2
ORDER BY orders DESC;
```

## Real-world scenarios

- KPI tiles: today / this week / this month counts in one query.
- Pivot reports by year, quarter or status.
- Ratios such as on-time delivery rate per carrier.

## PostgreSQL specifics

- PostgreSQL has supported `FILTER` since 9.4. SQLite supports it too. MySQL, SQL Server and Oracle do not; use `CASE` there.
- `FILTER` works only on aggregate functions, not on plain window functions like `ROW_NUMBER()`.
- `FILTER` is applied before `DISTINCT` and `ORDER BY` inside the aggregate.

## Visual explanation

| Approach | Count late orders |
|---|---|
| FILTER | `COUNT(*) FILTER (WHERE shipped_date > required_date)` |
| CASE + COUNT | `COUNT(CASE WHEN shipped_date > required_date THEN 1 END)` |
| CASE + SUM | `SUM(CASE WHEN shipped_date > required_date THEN 1 ELSE 0 END)` |

## Common mistakes

- Using `FILTER` in MySQL or SQL Server: syntax error.
- Expecting `SUM(...) FILTER` to return 0 on no matches. It returns NULL; add `COALESCE`.
- Writing `FILTER (cond)` without `WHERE`.
- Putting the condition in the query `WHERE`, which filters every aggregate.

## Performance

- Same single scan as `CASE`; the planner treats both alike.
- Push conditions shared by all aggregates into the query `WHERE`.

## Interview questions

### What does FILTER do?

It limits one aggregate to rows that satisfy a condition, while other aggregates in the same query still see every row.

### FILTER vs CASE inside an aggregate?

Same result and similar speed. `FILTER` is clearer and avoids the `ELSE 0` mistake but is not portable to MySQL or SQL Server.

### What does SUM(x) FILTER (WHERE false) return?

NULL. `COUNT(*) FILTER (WHERE false)` returns 0.

## Quick revision

- `agg(expr) FILTER (WHERE cond)`.
- SQL standard; supported in PostgreSQL and SQLite.
- Works with `COUNT DISTINCT`, `STRING_AGG`, window aggregates and `HAVING`.
- Empty match: `COUNT` = 0, others = NULL.
- Use `CASE` for portability.
