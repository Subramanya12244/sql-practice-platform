---
title: ORDER BY
slug: order-by
category: fundamentals
difficulty: Beginner
description: Sort SQL results with ORDER BY - multiple keys, ASC/DESC, NULLS FIRST/LAST, aliases, CASE-based custom order, and deterministic tie-breakers.
prerequisites: [select]
related: [limit-offset, case, null-handling, window-order-by, row-number]
questions: [3, 26, 122, 132]
patterns: [top-n-per-group]
guides: [sql-order-of-execution]
minutes: 7
version: 1
---

## Introduction

SQL tables have no inherent order. The only way to get rows back in a guaranteed order is `ORDER BY`.

## Definition

`ORDER BY` sorts the final result by one or more expressions, each `ASC` (default) or `DESC`, with optional `NULLS FIRST` or `NULLS LAST`.

## Why it matters

Top-N reports, pagination and readable output all depend on it. Interviewers look for tie-breakers and correct NULL placement.

## How it works

`ORDER BY` runs after `SELECT` and `DISTINCT`, so it can use select aliases and column positions. Rows are compared on the first key; ties go to the next key, and so on. Rows tied on every key come back in an unspecified order.

## Syntax

```sql-syntax
SELECT ...
FROM table_name
ORDER BY expr1 [ASC | DESC] [NULLS FIRST | NULLS LAST],
         expr2 [ASC | DESC] ...;
```

## Simple examples

```sql
SELECT product_name, unit_price
FROM products
ORDER BY unit_price DESC
LIMIT 5;
```

Multiple keys:

```sql
SELECT country, city, company_name
FROM customers
ORDER BY country, city, company_name
LIMIT 10;
```

## Intermediate examples

Sort by an alias:

```sql
SELECT order_id,
       SUM(unit_price * quantity) AS gross
FROM order_details
GROUP BY order_id
ORDER BY gross DESC
LIMIT 5;
```

NULL placement. In PostgreSQL NULLs sort last for `ASC` and first for `DESC`:

```sql
SELECT order_id, shipped_date
FROM orders
ORDER BY shipped_date DESC NULLS LAST, order_id
LIMIT 5;
```

## Advanced examples

Custom order with `CASE`: put chosen countries first, then the rest alphabetically.

```sql
SELECT DISTINCT country,
       CASE country WHEN 'USA' THEN 1 WHEN 'Germany' THEN 2 ELSE 3 END AS sort_key
FROM customers
ORDER BY sort_key, country
LIMIT 6;
```

Deterministic tie-breaker: several products share a price, so add the primary key.

```sql
SELECT product_id, product_name, unit_price
FROM products
ORDER BY unit_price DESC, product_id
LIMIT 10;
```

## Real-world scenarios

- Leaderboards and top-N reports.
- Stable pagination (sort key plus a unique column).
- Business-defined orders: status workflow, priority tiers.

## PostgreSQL specifics

- Default: `NULLS LAST` for `ASC`, `NULLS FIRST` for `DESC`. Other databases differ (SQL Server and MySQL treat NULL as smallest).
- With `SELECT DISTINCT`, every `ORDER BY` expression must appear in the select list.
- Text sort order depends on the column's collation.

## Visual explanation

| unit_price | product_id | order (DESC, id) |
|---|---|---|
| 263.50 | 38 | 1 |
| 123.79 | 29 | 2 |
| 97.00 | 9 | 3 |

Equal prices are ordered by `product_id`, so the result is repeatable.

## Common mistakes

- Relying on insertion order or "it always came back sorted".
- No tie-breaker before `LIMIT`: results can change between runs.
- `ORDER BY 2` (column position) breaks silently when the select list changes.
- Forgetting `NULLS LAST` on a `DESC` sort, so NULLs appear on top.
- Sorting inside a subquery and expecting the outer query to keep that order.

## Performance

Sorting is O(n log n) and may spill to disk when it exceeds `work_mem`. An index matching the `ORDER BY` (including direction and NULLS order) lets PostgreSQL read rows already sorted, which is especially fast with `LIMIT`.

## Interview questions

### Is the order of rows guaranteed without ORDER BY?

No. It depends on the plan and can change at any time.

### Where do NULLs sort in PostgreSQL?

Last in ascending order, first in descending order. Override with `NULLS FIRST` / `NULLS LAST`.

### How do you implement a custom sort order?

`ORDER BY CASE col WHEN 'A' THEN 1 WHEN 'B' THEN 2 ELSE 3 END, col`.

### Why add a unique column to ORDER BY when paginating?

Without it, tied rows can move between pages, so rows get skipped or repeated.

## Quick revision

- No `ORDER BY`, no order.
- Multiple keys sort left to right; `ASC` is the default.
- PostgreSQL: NULLs last for ASC, first for DESC.
- Aliases work in `ORDER BY`.
- Add a unique tie-breaker before `LIMIT`.
- Use `CASE` for custom orders.
