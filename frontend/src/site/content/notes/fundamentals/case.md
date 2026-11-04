---
title: CASE expressions
slug: case
category: fundamentals
difficulty: Beginner
description: Use SQL CASE for if-then logic - simple and searched forms, bucketing, custom sorting, safe division and conditional aggregation in PostgreSQL.
prerequisites: [select, logical-operators]
related: [conditional-aggregation, count-case-when, filter-clause, null-handling, order-by]
questions: [128, 129, 130, 132, 134]
patterns: [conditional-aggregation, pivot-report]
guides: [conditional-aggregation-pivot]
minutes: 8
version: 1
---

## Introduction

`CASE` is SQL's if/else. It returns a value, so it can appear anywhere an expression can: `SELECT`, `WHERE`, `ORDER BY`, `GROUP BY` and inside aggregates.

## Definition

- **Searched CASE**: `CASE WHEN condition THEN result ... ELSE default END`
- **Simple CASE**: `CASE expr WHEN value THEN result ... END`

The first matching `WHEN` wins. With no match and no `ELSE`, the result is NULL.

## Why it matters

Bucketing, labelling, pivoting and custom sorts all use `CASE`. Conditional aggregation (`SUM(CASE WHEN ...)`) is a top interview pattern.

## How it works

Branches are tested top to bottom; evaluation stops at the first TRUE condition. All `THEN` results must share a compatible type. A simple `CASE` uses `=`, so `WHEN NULL` never matches.

## Syntax

```sql-syntax
CASE
  WHEN condition1 THEN result1
  WHEN condition2 THEN result2
  ELSE default_result
END

CASE expression
  WHEN value1 THEN result1
  WHEN value2 THEN result2
  ELSE default_result
END
```

## Simple examples

Price bands (order of `WHEN` matters):

```sql
SELECT product_name, unit_price,
       CASE
         WHEN unit_price >= 50 THEN 'Premium'
         WHEN unit_price >= 20 THEN 'Standard'
         ELSE 'Budget'
       END AS price_band
FROM products
ORDER BY unit_price DESC
LIMIT 8;
```

Simple form:

```sql
SELECT shipper_id, company_name,
       CASE shipper_id WHEN 1 THEN 'Express' WHEN 2 THEN 'Ground' ELSE 'Other' END AS service
FROM shippers;
```

## Intermediate examples

Group by a `CASE` bucket:

```sql
SELECT CASE
         WHEN unit_price >= 50 THEN 'Premium'
         WHEN unit_price >= 20 THEN 'Standard'
         ELSE 'Budget'
       END AS price_band,
       COUNT(*) AS products,
       ROUND(AVG(unit_price), 2) AS avg_price
FROM products
GROUP BY 1
ORDER BY avg_price DESC;
```

Custom sort:

```sql
SELECT company_name, country
FROM customers
ORDER BY CASE WHEN country = 'Mexico' THEN 0 ELSE 1 END, company_name
LIMIT 6;
```

## Advanced examples

Conditional aggregation: shipping status per employee in one pass.

```sql
SELECT employee_id,
       SUM(CASE WHEN shipped_date IS NULL THEN 1 ELSE 0 END)            AS unshipped,
       SUM(CASE WHEN shipped_date > required_date THEN 1 ELSE 0 END)    AS late,
       SUM(CASE WHEN shipped_date <= required_date THEN 1 ELSE 0 END)   AS on_time
FROM orders
WHERE employee_id IS NOT NULL
GROUP BY employee_id
ORDER BY employee_id;
```

Guarded division: `CASE` evaluates only the matching branch for row values.

```sql
SELECT product_name, units_in_stock, reorder_level,
       CASE WHEN reorder_level = 0 THEN NULL
            ELSE ROUND(units_in_stock::numeric / reorder_level, 2)
       END AS stock_cover
FROM products
ORDER BY product_id
LIMIT 6;
```

## Real-world scenarios

- Customer segmentation (VIP / regular / new).
- Pivot reports: one column per year or status.
- Mapping codes to labels.
- Business-priority sorting.

## PostgreSQL specifics

- `COUNT(*) FILTER (WHERE ...)` is a PostgreSQL alternative to `SUM(CASE WHEN ...)` and is often clearer.
- PostgreSQL may still evaluate constant sub-expressions in all branches at plan time, so `CASE WHEN false THEN 1/0 END` can error. Row-dependent expressions are safe.
- `GREATEST`/`LEAST`, `COALESCE` and `NULLIF` are shortcuts for common `CASE` forms.

## Visual explanation

```text
unit_price = 35
  WHEN >= 50  -> false
  WHEN >= 20  -> true  -> 'Standard'   (stop)
  ELSE        -> not reached
```

## Common mistakes

- Overlapping ranges in the wrong order (`>= 20` before `>= 50` makes Premium unreachable).
- Missing `ELSE`: unmatched rows become NULL.
- `CASE col WHEN NULL`: never matches; use `CASE WHEN col IS NULL`.
- Mixed result types (`THEN 1 ELSE 'none'`) cause a type error.
- `COUNT(CASE WHEN cond THEN 1 ELSE 0 END)` counts every row; use `SUM`, or drop the `ELSE`.

## Performance

`CASE` itself is cheap. Conditional aggregation replaces several scans or self-joins with one scan, which is usually a big win. `CASE` in `WHERE` usually cannot use an index; rewrite as plain conditions if possible.

## Interview questions

### What is the difference between simple and searched CASE?

Simple compares one expression to values with `=`. Searched evaluates independent boolean conditions, so it supports ranges and `IS NULL`.

### What does CASE return when nothing matches?

The `ELSE` value, or NULL when there is no `ELSE`.

### How do you count rows meeting a condition per group?

`SUM(CASE WHEN cond THEN 1 ELSE 0 END)`, `COUNT(CASE WHEN cond THEN 1 END)`, or in PostgreSQL `COUNT(*) FILTER (WHERE cond)`.

### Why does COUNT(CASE WHEN x THEN 1 ELSE 0 END) give the wrong answer?

`COUNT` counts non-NULL values, and 0 is not NULL. Remove the `ELSE` or use `SUM`.

## Quick revision

- First matching `WHEN` wins; order ranges carefully.
- No `ELSE` means NULL.
- Works in SELECT, WHERE, GROUP BY, ORDER BY and aggregates.
- `SUM(CASE ...)` / `COUNT(*) FILTER` for conditional aggregation.
- Use searched CASE for NULL tests.
