---
title: WHERE
slug: where
category: fundamentals
difficulty: Beginner
description: Filter rows with SQL WHERE in PostgreSQL - comparisons, ranges, lists, patterns, NULL checks, and the WHERE vs HAVING difference.
prerequisites: [select]
related: [comparison-operators, logical-operators, null-handling, having, in-not-in]
questions: [161, 163, 170, 185]
patterns: []
guides: [group-by-having]
minutes: 7
version: 1
---

## Introduction

`WHERE` keeps only the rows whose condition is true. It is the main tool for narrowing data before joins are aggregated, sorted or returned.

## Definition

`WHERE condition` evaluates a boolean expression for each row from `FROM`. Rows where it is `TRUE` are kept. Rows where it is `FALSE` **or `NULL`** are discarded.

## Why it matters

Correct filtering is the difference between a right and a wrong answer. Interviewers check NULL handling, date ranges and `WHERE` vs `HAVING`.

## How it works

`WHERE` runs after `FROM`/`JOIN` and before `GROUP BY`. It sees individual rows, so it cannot use aggregates like `SUM()` and cannot use `SELECT` aliases.

## Syntax

```sql-syntax
SELECT columns
FROM table_name
WHERE condition [AND | OR condition ...];
```

## Simple examples

Equality:

```sql
SELECT company_name, city
FROM customers
WHERE country = 'France';
```

Numeric comparison:

```sql
SELECT product_name, unit_price
FROM products
WHERE unit_price > 50
ORDER BY unit_price DESC;
```

## Intermediate examples

Ranges, lists and patterns. A half-open date range for one month looks like this:

```sql-syntax
WHERE order_date >= DATE '2025-01-01'
  AND order_date <  DATE '2025-02-01'
```

The runnable version below keeps the first 60 days of order history, whatever years the data covers:

```sql
SELECT order_id, order_date
FROM orders
WHERE order_date >= (SELECT MIN(order_date) FROM orders)
  AND order_date <  (SELECT MIN(order_date) FROM orders) + 60
ORDER BY order_date;
```

```sql
SELECT company_name, country
FROM customers
WHERE country IN ('Spain', 'Italy', 'Portugal')
  AND company_name ILIKE '%a%';
```

NULL check: orders not yet shipped.

```sql
SELECT order_id, order_date, required_date
FROM orders
WHERE shipped_date IS NULL
ORDER BY order_date;
```

## Advanced examples

Compare two columns of the same row: late shipments.

```sql
SELECT order_id,
       shipped_date - required_date AS days_late
FROM orders
WHERE shipped_date > required_date
ORDER BY days_late DESC;
```

Filter on a subquery result:

```sql
SELECT product_name, unit_price
FROM products
WHERE unit_price > (SELECT AVG(unit_price) FROM products)
ORDER BY unit_price DESC
LIMIT 5;
```

## Real-world scenarios

- Reporting periods: `order_date >= start AND order_date < end`.
- Operational queues: `shipped_date IS NULL`.
- Search boxes: `ILIKE '%term%'`.
- Safe updates and deletes: always test the `WHERE` with a `SELECT` first.

## PostgreSQL specifics

- `ILIKE` (case-insensitive `LIKE`) is PostgreSQL-specific.
- `DATE '2025-01-01'` is a typed literal; `'2025-01-01'::date` also works.
- `~` and `~*` do regular-expression matching in PostgreSQL.

## Visual explanation

| order_id | shipped_date | `shipped_date IS NULL` | kept? |
|---|---|---|---|
| A | 2025-01-03 | false | no |
| B | NULL | true | yes |

With `shipped_date = NULL` the condition is NULL for every row, so nothing is kept.

## Common mistakes

- `WHERE col = NULL`: always NULL, returns no rows. Use `IS NULL`.
- `WHERE SUM(x) > 10`: aggregates belong in `HAVING`.
- `BETWEEN` on timestamps: `BETWEEN '2025-01-01' AND '2025-01-31'` misses times after midnight on the 31st. Use a half-open range.
- Mixing `AND`/`OR` without parentheses.
- Filtering the right table of a `LEFT JOIN` in `WHERE`, which turns it into an inner join.

## Performance

Conditions of the form `column op constant` can use a B-tree index. Wrapping the column in a function (`WHERE EXTRACT(YEAR FROM order_date) = 2025`) usually prevents index use; rewrite as a range. A leading wildcard (`LIKE '%x'`) cannot use a plain B-tree index.

## Interview questions

### What is the difference between WHERE and HAVING?

`WHERE` filters rows before grouping and cannot use aggregates. `HAVING` filters groups after aggregation.

### Why does WHERE col = NULL return nothing?

Any comparison with NULL yields NULL (unknown), and `WHERE` keeps only TRUE rows. Use `IS NULL`.

### How do you filter one calendar month correctly?

Use a half-open range: `col >= '2025-01-01' AND col < '2025-02-01'`. It works for dates and timestamps and can use an index.

### Is WHERE evaluated before or after JOIN?

Logically after `FROM`/`JOIN`. The planner may push filters down, but the result is the same for inner joins.

## Quick revision

- `WHERE` keeps rows where the condition is TRUE; FALSE and NULL are dropped.
- Use `IS NULL` / `IS NOT NULL` for NULLs.
- No aggregates or `SELECT` aliases in `WHERE`.
- Prefer half-open date ranges.
- Keep the column bare to allow index use.
