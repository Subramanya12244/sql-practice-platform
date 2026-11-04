---
title: NULL handling
slug: null-handling
category: fundamentals
difficulty: Intermediate
description: How NULL behaves in SQL - IS NULL, COALESCE, NULLIF, NULLs in aggregates, joins, sorting and NOT IN, with PostgreSQL examples.
prerequisites: [where, comparison-operators]
related: [logical-operators, case, left-join, count, in-not-in]
questions: [25, 27, 57, 161, 182]
patterns: [missing-records, anti-join]
guides: [null-handling-coalesce, count-star-vs-count-column]
minutes: 9
version: 1
---

## Introduction

NULL means "unknown or missing". It is not zero and not an empty string. It follows its own rules in comparisons, aggregates, joins and sorting.

## Definition

NULL is a marker for an absent value. Any comparison or arithmetic with NULL yields NULL (except `IS [NOT] NULL`, `IS [NOT] DISTINCT FROM`, and a few functions like `COALESCE` and `CONCAT`).

## Why it matters

NULLs explain many wrong counts and missing rows. Outer joins create NULLs, so this topic appears in almost every join and aggregation question.

## How it works

- `NULL = NULL` is NULL, so `WHERE` drops it.
- `1 + NULL` is NULL; `'a' || NULL` is NULL.
- Aggregates (`SUM`, `AVG`, `COUNT(col)`, `MIN`, `MAX`) skip NULLs. `COUNT(*)` counts rows.
- `SUM` of zero non-NULL values is NULL, not 0.
- `GROUP BY` and `DISTINCT` treat all NULLs as one group.

## Syntax

```sql-syntax
col IS NULL / col IS NOT NULL
COALESCE(a, b, c)        -- first non-NULL argument
NULLIF(a, b)             -- NULL if a = b, else a
a IS DISTINCT FROM b     -- NULL-safe <>
ORDER BY col NULLS FIRST | NULLS LAST
```

## Simple examples

The one order without an employee:

```sql
SELECT order_id, customer_id, employee_id
FROM orders
WHERE employee_id IS NULL;
```

Replace NULL for display:

```sql
SELECT order_id,
       COALESCE(shipped_date::text, 'not shipped') AS shipped
FROM orders
ORDER BY shipped_date DESC NULLS FIRST
LIMIT 5;
```

## Intermediate examples

`COUNT(*)` vs `COUNT(col)`:

```sql
SELECT COUNT(*)            AS all_orders,
       COUNT(shipped_date) AS shipped_orders,
       COUNT(employee_id)  AS orders_with_employee
FROM orders;
```

Outer joins create NULLs; `COALESCE` turns them into 0:

```sql
SELECT c.customer_id,
       COUNT(o.order_id)              AS orders,
       COALESCE(SUM(o.freight), 0)    AS total_freight
FROM customers c
LEFT JOIN orders o ON o.customer_id = c.customer_id
GROUP BY c.customer_id
ORDER BY orders, c.customer_id
LIMIT 5;
```

## Advanced examples

Safe division with `NULLIF`: divide by NULL instead of zero.

```sql
SELECT product_name,
       units_in_stock,
       reorder_level,
       ROUND(units_in_stock::numeric / NULLIF(reorder_level, 0), 2) AS cover_ratio
FROM products
ORDER BY product_id
LIMIT 6;
```

The `NOT IN` trap. `orders.employee_id` contains one NULL, so `NOT IN` returns no rows while `NOT EXISTS` works:

```sql
SELECT
  (SELECT COUNT(*) FROM employees e
    WHERE e.employee_id NOT IN (SELECT employee_id FROM orders))         AS not_in_result,
  (SELECT COUNT(*) FROM employees e
    WHERE NOT EXISTS (SELECT 1 FROM orders o
                      WHERE o.employee_id = e.employee_id))              AS not_exists_result;
```

`AVG` ignores NULLs, which may or may not be what you want:

```sql
SELECT ROUND(AVG(shipped_date - order_date), 2)                AS avg_days_shipped_only,
       COUNT(*) FILTER (WHERE shipped_date IS NULL)             AS ignored_rows
FROM orders;
```

## Real-world scenarios

- Optional attributes (phone, region, ship date).
- Reports that must show 0 instead of blank for customers with no orders.
- Safe ratios and percentages with `NULLIF`.
- Change detection with `IS DISTINCT FROM`.

## PostgreSQL specifics

- NULLs sort last in `ASC` and first in `DESC` by default.
- `CONCAT()` and `CONCAT_WS()` ignore NULLs; `||` does not.
- A `UNIQUE` constraint allows many NULLs unless declared `NULLS NOT DISTINCT` (PostgreSQL 15+).
- `NULL::type` gives a typed NULL, useful in `UNION` and `CASE`.

## Visual explanation

| expression | result |
|---|---|
| `NULL = NULL` | NULL |
| `NULL IS NULL` | true |
| `5 + NULL` | NULL |
| `COALESCE(NULL, 0)` | 0 |
| `NULLIF(0, 0)` | NULL |
| `COUNT(col)` over (1, NULL, 3) | 2 |
| `SUM(col)` over (NULL, NULL) | NULL |

## Common mistakes

- `WHERE col = NULL` or `<> NULL`.
- `NOT IN` against a column that can hold NULLs.
- `COUNT(col)` when you meant to count rows.
- Forgetting `COALESCE(SUM(...), 0)` after a `LEFT JOIN`.
- Putting `WHERE right_table.col = ...` after a `LEFT JOIN`, which removes the NULL rows.

## Performance

B-tree indexes store NULLs, so `IS NULL` can use an index. A partial index such as `WHERE shipped_date IS NULL` is ideal for "open items" queues. `NOT EXISTS` is both safer and usually faster than `NOT IN` on nullable columns.

## Interview questions

### What is the difference between COUNT(*) and COUNT(column)?

`COUNT(*)` counts rows. `COUNT(column)` counts rows where that column is not NULL.

### Why does NOT IN return no rows when the subquery has a NULL?

`x NOT IN (a, NULL)` means `x <> a AND x <> NULL`; the second part is NULL, so the whole condition is never TRUE.

### What is the difference between COALESCE and NULLIF?

`COALESCE` returns the first non-NULL argument. `NULLIF(a, b)` returns NULL when `a = b`, otherwise `a`.

### How do you avoid division by zero?

`x / NULLIF(y, 0)`, which returns NULL instead of raising an error.

### Does SUM over no rows return 0?

No, it returns NULL. Wrap it in `COALESCE(SUM(x), 0)`.

## Quick revision

- NULL is unknown; comparisons with it are NULL.
- Test with `IS NULL`; compare NULL-safely with `IS DISTINCT FROM`.
- Aggregates skip NULLs; `COUNT(*)` does not.
- `COALESCE` for defaults, `NULLIF` for safe division.
- Prefer `NOT EXISTS` over `NOT IN` for nullable columns.
- `LEFT JOIN` + `COALESCE(SUM(...), 0)` for zero-filled reports.
