---
title: COUNT
slug: count
category: aggregations
difficulty: Beginner
description: How COUNT(*), COUNT(column) and COUNT(DISTINCT) differ, how they treat NULLs, and how to count correctly after joins in PostgreSQL.
prerequisites: [select, where]
related: [sum, group-by, having, count-case-when, filter-clause, null-handling]
questions: [5, 9, 10, 12, 25, 35]
patterns: [find-duplicates]
guides: [count-star-vs-count-column, aggregate-functions]
minutes: 7
version: 1
---

## Introduction

`COUNT` answers "how many?". It is the most used aggregate and the one with the most interview traps: NULLs, DISTINCT and join fan-out.

## Definition

`COUNT` is an aggregate function that returns the number of input rows (or non-NULL values) in a group as a `bigint`.

- `COUNT(*)` counts rows.
- `COUNT(expr)` counts rows where `expr` is not NULL.
- `COUNT(DISTINCT expr)` counts distinct non-NULL values.

## Why it matters

Order counts, customers per country, products per category and duplicate detection all start with `COUNT`. Picking the wrong form gives silently wrong numbers.

## How it works

The database collects the rows of each group (or the whole result if there is no `GROUP BY`), evaluates the argument per row, skips NULLs (except for `*`), and returns the tally. With no rows at all, `COUNT` returns 0, not NULL.

## Syntax

```sql-syntax
SELECT COUNT(*)               FROM table_name;
SELECT COUNT(column_name)     FROM table_name;
SELECT COUNT(DISTINCT column) FROM table_name;
SELECT group_col, COUNT(*)    FROM table_name GROUP BY group_col;
```

## Simple examples

Total orders:

```sql
SELECT COUNT(*) AS total_orders FROM orders;
```

`COUNT(*)` versus `COUNT(column)`: one order has a NULL `employee_id`, so the two counts differ by one.

```sql
SELECT COUNT(*) AS all_orders,
       COUNT(employee_id) AS orders_with_employee
FROM orders;
```

## Intermediate examples

Distinct customers who ordered at least once:

```sql
SELECT COUNT(DISTINCT customer_id) AS ordering_customers FROM orders;
```

Customers per country, largest first:

```sql
SELECT country, COUNT(*) AS customers
FROM customers
GROUP BY country
ORDER BY customers DESC, country
LIMIT 5;
```

## Advanced examples

Count orders per customer including customers with zero orders. Count the right-side key, not `*`, or empty customers show 1.

```sql
SELECT c.customer_id,
       COUNT(o.order_id) AS orders,
       COUNT(*)          AS wrong_count
FROM customers c
LEFT JOIN orders o ON o.customer_id = c.customer_id
WHERE c.customer_id IN ('FISSA', 'PARIS', 'ALFKI')
GROUP BY c.customer_id
ORDER BY c.customer_id;
```

Join fan-out: joining `order_details` multiplies order rows, so use `COUNT(DISTINCT)` to count orders.

```sql
SELECT o.employee_id,
       COUNT(*)                   AS order_lines,
       COUNT(DISTINCT o.order_id) AS orders
FROM orders o
JOIN order_details od ON od.order_id = o.order_id
WHERE o.employee_id IS NOT NULL
GROUP BY o.employee_id
ORDER BY o.employee_id;
```

## Real-world scenarios

- Active customers per month: `COUNT(DISTINCT customer_id)` grouped by month.
- Duplicate detection: `GROUP BY key HAVING COUNT(*) > 1`.
- Data quality: `COUNT(*) - COUNT(col)` gives the number of NULLs in `col`.

## PostgreSQL specifics

- `COUNT` returns `bigint` in PostgreSQL.
- PostgreSQL supports `COUNT(*) FILTER (WHERE ...)` for conditional counts (see the FILTER clause note).
- `COUNT(DISTINCT (a, b))` counts distinct row values in PostgreSQL; some databases use `COUNT(DISTINCT a, b)` instead.

## Visual explanation

| employee_id | counted by COUNT(*) | counted by COUNT(employee_id) |
|-------------|---------------------|-------------------------------|
| 4           | yes                 | yes                           |
| 4           | yes                 | yes                           |
| NULL        | yes                 | no                            |
| total       | 3                   | 2                             |

## Common mistakes

- Using `COUNT(*)` after a `LEFT JOIN`: unmatched rows count as 1.
- Forgetting fan-out: counting orders after joining line items.
- Expecting `COUNT(col)` to include NULLs.
- Writing `COUNT(DISTINCT *)`: not valid.

## Performance

- `COUNT(*)` on a whole table is a full scan in PostgreSQL (MVCC means there is no stored row count). Use `pg_class.reltuples` for a fast estimate.
- `COUNT(DISTINCT)` sorts or hashes; it is slower than plain `COUNT` on large inputs.
- An index-only scan can speed up counts when the visibility map is up to date.

## Interview questions

### What is the difference between COUNT(*) and COUNT(column)?

`COUNT(*)` counts every row. `COUNT(column)` counts only rows where the column is not NULL.

### What does COUNT return for an empty table?

0. Other aggregates such as `SUM` return NULL.

### Why does a LEFT JOIN with COUNT(*) show 1 for customers without orders?

The unmatched customer still produces one row with NULL order columns. Count `o.order_id` instead.

### How do you count unique values?

`COUNT(DISTINCT column)`. It ignores NULLs.

## Quick revision

- `COUNT(*)` counts rows; `COUNT(col)` skips NULLs.
- `COUNT(DISTINCT col)` counts unique non-NULL values.
- Empty input gives 0, never NULL.
- After a LEFT JOIN, count the right table's key.
- Joins to detail tables inflate counts; use DISTINCT.
- Result type is `bigint` in PostgreSQL.
