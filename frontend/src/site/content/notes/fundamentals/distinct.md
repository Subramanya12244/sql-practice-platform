---
title: DISTINCT
slug: distinct
category: fundamentals
difficulty: Beginner
description: Remove duplicate rows with SQL DISTINCT, count unique values with COUNT(DISTINCT), and use PostgreSQL DISTINCT ON for one row per group.
prerequisites: [select]
related: [count, group-by, order-by, row-number, union]
questions: [9, 10, 12, 32, 127]
patterns: [find-duplicates, remove-duplicates, latest-record-per-group]
guides: [find-duplicates]
minutes: 7
version: 1
---

## Introduction

Joins and projections often produce repeated rows. `DISTINCT` collapses identical result rows into one. `COUNT(DISTINCT col)` counts unique values.

## Definition

`SELECT DISTINCT` removes duplicate rows from the result. Two rows are duplicates when **every** selected column is equal; NULLs count as equal to each other for this purpose.

## Why it matters

"How many unique customers?" and "list each country once" are everyday questions. Interviewers also check that you do not use `DISTINCT` to hide a bad join.

## How it works

`DISTINCT` runs after `SELECT` and before `ORDER BY`. PostgreSQL removes duplicates by sorting or hashing the result rows.

## Syntax

```sql-syntax
SELECT DISTINCT col1, col2 FROM table_name;
SELECT COUNT(DISTINCT col) FROM table_name;
SELECT DISTINCT ON (group_col) col1, col2
FROM table_name
ORDER BY group_col, sort_col DESC;          -- PostgreSQL only
```

## Simple examples

Each customer country once:

```sql
SELECT DISTINCT country
FROM customers
ORDER BY country;
```

Distinct applies to the whole row, not one column:

```sql
SELECT DISTINCT country, city
FROM customers
ORDER BY country, city
LIMIT 10;
```

## Intermediate examples

Count unique values:

```sql
SELECT COUNT(*)                    AS orders,
       COUNT(DISTINCT customer_id) AS customers_who_ordered,
       COUNT(DISTINCT employee_id) AS employees_who_sold
FROM orders;
```

Unique customers served per employee:

```sql
SELECT employee_id, COUNT(DISTINCT customer_id) AS customers_served
FROM orders
WHERE employee_id IS NOT NULL
GROUP BY employee_id
ORDER BY customers_served DESC;
```

## Advanced examples

`DISTINCT ON` returns the first row of each group according to `ORDER BY`. Latest order per customer:

```sql
SELECT DISTINCT ON (customer_id)
       customer_id, order_id, order_date
FROM orders
ORDER BY customer_id, order_date DESC, order_id DESC
LIMIT 10;
```

Find duplicated values with `GROUP BY` instead (DISTINCT hides them):

```sql
SELECT city, country, COUNT(*) AS customers
FROM customers
GROUP BY city, country
HAVING COUNT(*) > 1
ORDER BY customers DESC;
```

## Real-world scenarios

- Unique visitors, buyers or products sold in a period.
- Dropdown lists of countries or categories.
- Picking one representative row per key with `DISTINCT ON`.

## PostgreSQL specifics

- `DISTINCT ON (...)` is a PostgreSQL extension. Its expressions must match the leftmost `ORDER BY` items.
- `COUNT(DISTINCT a, b)` is not allowed; use `COUNT(DISTINCT (a, b))` with a row value, or a subquery.
- `IS DISTINCT FROM` is a NULL-safe comparison, unrelated to `SELECT DISTINCT`.

## Visual explanation

```text
SELECT country           SELECT DISTINCT country
--------                 --------
Germany                  Germany
Germany        ──►       France
France                   Spain
Spain
France
```

## Common mistakes

- Thinking `DISTINCT` applies to the first column only. It applies to the whole row.
- Using `DISTINCT` to cover duplicated rows caused by a wrong or one-to-many join. Fix the join or aggregate first.
- `SELECT DISTINCT ... ORDER BY col_not_selected`: PostgreSQL rejects it.
- `COUNT(DISTINCT col)` ignores NULLs.

## Performance

`DISTINCT` needs a sort or hash over the full result, which costs memory and time on large sets. If you only need existence, `EXISTS` is cheaper than `DISTINCT` on a join. An index on the `DISTINCT ON` key plus sort column helps.

## Interview questions

### What is the difference between DISTINCT and GROUP BY?

Both can produce unique rows. `GROUP BY` also lets you compute aggregates per group. For plain deduplication they usually produce the same plan.

### Does COUNT(DISTINCT col) count NULL?

No. Aggregate functions other than `COUNT(*)` ignore NULLs.

### How do you get one row per group in PostgreSQL?

`DISTINCT ON (group) ... ORDER BY group, sort DESC`, or portable `ROW_NUMBER() OVER (PARTITION BY group ORDER BY sort DESC) = 1`.

### Why is "SELECT DISTINCT" after a join a code smell?

It often hides a fan-out from a one-to-many join. The real fix is joining at the right grain or using `EXISTS`.

## Quick revision

- `DISTINCT` deduplicates whole result rows.
- `COUNT(DISTINCT col)` counts unique non-NULL values.
- `DISTINCT ON` (PostgreSQL) keeps the first row per key by `ORDER BY`.
- Use `GROUP BY ... HAVING COUNT(*) > 1` to find duplicates.
- Do not use `DISTINCT` to mask join fan-out.
