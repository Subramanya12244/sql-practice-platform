---
title: COUNT with CASE WHEN
slug: count-case-when
category: aggregations
difficulty: Intermediate
description: Count only rows that meet a condition with COUNT(CASE WHEN ... THEN 1 END) and SUM(CASE ...). Avoid the ELSE 0 trap.
prerequisites: [count, case]
related: [conditional-aggregation, filter-clause, sum, null-handling]
questions: [179, 86, 92, 93]
patterns: [conditional-aggregation, pivot-report]
guides: [conditional-aggregation-pivot, count-star-vs-count-column]
minutes: 6
version: 1
---

## Introduction

`COUNT(CASE WHEN ... THEN 1 END)` counts only the rows that meet a condition. It is the portable way to produce several counts in one query.

## Definition

`COUNT(expr)` counts non-NULL values. A `CASE` without `ELSE` returns NULL when the condition is false. So `COUNT(CASE WHEN cond THEN 1 END)` counts the rows where `cond` is true.

## Why it matters

It works in every major database. Interviewers use it to test whether you understand how `COUNT` treats NULL.

## How it works

| Row matches? | `CASE ... THEN 1 END` | Counted by `COUNT`? |
|---|---|---|
| yes | 1 | yes |
| no | NULL | no |

`SUM(CASE WHEN cond THEN 1 ELSE 0 END)` gives the same number, except it returns NULL (not 0) on zero rows only if every value is NULL.

## Syntax

```sql-syntax
SELECT COUNT(CASE WHEN condition THEN 1 END)          AS matching_rows,
       SUM(CASE WHEN condition THEN 1 ELSE 0 END)     AS matching_rows_alt
FROM table_name;
```

## Simple examples

Shipped and unshipped orders:

```sql
SELECT COUNT(*)                                          AS total,
       COUNT(CASE WHEN shipped_date IS NOT NULL THEN 1 END) AS shipped,
       COUNT(CASE WHEN shipped_date IS NULL THEN 1 END)     AS unshipped
FROM orders;
```

Expensive products:

```sql
SELECT COUNT(CASE WHEN unit_price > 50 THEN 1 END) AS over_50,
       COUNT(CASE WHEN unit_price <= 50 THEN 1 END) AS up_to_50
FROM products;
```

## Intermediate examples

Per-employee late shipments:

```sql
SELECT employee_id,
       COUNT(*)                                                AS orders,
       COUNT(CASE WHEN shipped_date > required_date THEN 1 END) AS late
FROM orders
WHERE employee_id IS NOT NULL
GROUP BY employee_id
ORDER BY late DESC, employee_id;
```

Distinct customers by condition: `COUNT(DISTINCT CASE ...)` returns the customer id or NULL:

```sql
SELECT COUNT(DISTINCT CASE WHEN EXTRACT(YEAR FROM order_date) = 1997 THEN customer_id END) AS customers_1997,
       COUNT(DISTINCT CASE WHEN EXTRACT(YEAR FROM order_date) = 1998 THEN customer_id END) AS customers_1998
FROM orders;
```

## Advanced examples

Percentages from conditional counts:

```sql
SELECT ship_country,
       COUNT(*) AS orders,
       ROUND(100.0 * COUNT(CASE WHEN freight > 50 THEN 1 END) / COUNT(*), 1) AS pct_heavy
FROM orders
GROUP BY ship_country
HAVING COUNT(*) >= 5
ORDER BY pct_heavy DESC;
```

Price bands per category in one row each:

```sql
SELECT category_id,
       COUNT(CASE WHEN unit_price < 20 THEN 1 END)                 AS cheap,
       COUNT(CASE WHEN unit_price >= 20 AND unit_price < 50 THEN 1 END) AS mid,
       COUNT(CASE WHEN unit_price >= 50 THEN 1 END)                AS premium
FROM products
GROUP BY category_id
ORDER BY category_id;
```

## Real-world scenarios

- Support: open vs closed tickets per agent.
- E-commerce: orders with and without a discount.
- Data quality: rows with missing values per column.

## PostgreSQL specifics

- PostgreSQL also offers `COUNT(*) FILTER (WHERE cond)`, which is clearer. See the FILTER clause note.
- A boolean can be counted directly: `COUNT(*) FILTER (WHERE discontinued)` or `SUM(discontinued::int)`.
- `COUNT` always returns `bigint` and never NULL.

## Visual explanation

```text
shipped_date   CASE WHEN shipped_date IS NULL THEN 1 END
1997-01-05     NULL
NULL           1        ──COUNT──▶ 2
NULL           1
1997-02-11     NULL
```

## Common mistakes

- `COUNT(CASE WHEN cond THEN 1 ELSE 0 END)`: counts every row because 0 is not NULL.
- `COUNT(CASE WHEN cond THEN 0 END)`: still counts matches (0 is non-NULL), but confuses readers. Use 1.
- Forgetting overlapping `WHEN` ranges; each `CASE` column is independent, so a row can be counted in two columns.
- Dividing two `COUNT`s without `100.0` and getting integer division.

## Performance

- All counts come from one scan.
- `COUNT(DISTINCT CASE ...)` needs a sort or hash per column and is the expensive part.

## Interview questions

### How do you count rows that meet a condition?

`COUNT(CASE WHEN cond THEN 1 END)` or `SUM(CASE WHEN cond THEN 1 ELSE 0 END)`. In PostgreSQL also `COUNT(*) FILTER (WHERE cond)`.

### What does COUNT(CASE WHEN x > 5 THEN 1 ELSE 0 END) return?

The total number of rows, because `COUNT` counts the zeros as non-NULL values.

### How do you count distinct customers who ordered in 1997?

`COUNT(DISTINCT CASE WHEN EXTRACT(YEAR FROM order_date) = 1997 THEN customer_id END)`.

## Quick revision

- `COUNT` ignores NULL; that is the trick.
- `COUNT(CASE WHEN c THEN 1 END)` = matching rows.
- Never add `ELSE 0` inside `COUNT`.
- `SUM(CASE ... 1 ELSE 0)` is the equivalent.
- `COUNT(DISTINCT CASE ... THEN col END)` for distinct conditional counts.
- Multiply by `100.0` for percentages.
