---
title: Correlated subqueries
slug: correlated-subqueries
category: subqueries
difficulty: Intermediate
description: Correlated subqueries reference the outer row, letting you compare each row to its own group, such as each product against its category average.
prerequisites: [scalar-subqueries, group-by]
related: [exists-not-exists, partition-by, join-vs-subquery, cte]
questions: [15, 16, 17, 18, 13]
patterns: [latest-record-per-group, top-n-per-group]
guides: [correlated-subquery]
minutes: 8
version: 1
---

## Introduction

"Products priced above their own category's average" needs a different average for each row. A correlated subquery computes a value for each outer row.

## Definition

A correlated subquery is a subquery that references a column from the outer query, such as `p.category_id`. Logically, it is evaluated again for every outer row.

## Why it matters

- It answers "compared with its peers" questions directly.
- `EXISTS` / `NOT EXISTS` are almost always correlated.
- Interviewers ask you to rewrite one as a JOIN or a window function and to discuss performance.

## How it works

1. The outer query reads a row.
2. The subquery runs using that row's values.
3. The outer `WHERE` or `SELECT` uses the result.
4. The next row repeats the process. The planner may turn this into a join instead.

## Syntax

```sql-syntax
SELECT o.col
FROM outer_table o
WHERE o.val > (SELECT AVG(i.val)
               FROM inner_table i
               WHERE i.group_key = o.group_key);
```

## Simple examples

Products priced above their category's average:

```sql
SELECT p.product_name, p.category_id, p.unit_price
FROM products p
WHERE p.unit_price > (
  SELECT AVG(p2.unit_price)
  FROM products p2
  WHERE p2.category_id = p.category_id
)
ORDER BY p.category_id, p.unit_price DESC;
```

## Intermediate examples

A correlated subquery in `SELECT` gives each customer's order count, and customers with no orders get 0:

```sql
SELECT c.customer_id,
       (SELECT COUNT(*) FROM orders o WHERE o.customer_id = c.customer_id) AS order_count
FROM customers c
ORDER BY order_count, c.customer_id
LIMIT 5;
```

Latest order for each customer:

```sql
SELECT o.customer_id, o.order_id, o.order_date
FROM orders o
WHERE o.order_date = (
  SELECT MAX(o2.order_date) FROM orders o2 WHERE o2.customer_id = o.customer_id
)
ORDER BY o.customer_id
LIMIT 5;
```

## Advanced examples

Most expensive product in each category, with ties kept, using a correlated subquery:

```sql
SELECT p.category_id, p.product_name, p.unit_price
FROM products p
WHERE p.unit_price = (
  SELECT MAX(unit_price) FROM products p2 WHERE p2.category_id = p.category_id
)
ORDER BY p.category_id;
```

The same idea using a window function, which scans the table once:

```sql
SELECT category_id, product_name, unit_price
FROM (
  SELECT p.*, AVG(unit_price) OVER (PARTITION BY category_id) AS cat_avg
  FROM products p
) t
WHERE unit_price > cat_avg
ORDER BY category_id, unit_price DESC;
```

## Real-world scenarios

- Employees earning above their department's average.
- Latest status per entity.
- Per-row counts in a report that must include zero counts.

## PostgreSQL specifics

- `EXPLAIN` shows a correlated subquery as a `SubPlan`, which is re-run for each row.
- PostgreSQL turns correlated `EXISTS` and `IN` into semi-joins. It does not de-correlate scalar subqueries in `SELECT` or `WHERE`.
- `LATERAL` joins are PostgreSQL's way to write correlated subqueries that return several columns or rows.

## Visual explanation

```text
outer row: Chai, cat 1, 18.00
   -> subquery: AVG(price) WHERE category_id = 1  -> 37.98
   -> 18.00 > 37.98 ? drop
outer row: Côte de Blaye, cat 1, 263.50
   -> subquery: same avg (cat 1)                  -> keep
```

## Common mistakes

- Using the same alias inside and outside without qualifying columns. `WHERE category_id = category_id` is always true.
- Expecting a `SELECT`-list correlated subquery to return several rows. It must return a single value.
- Ignoring the cost on large tables. A `SubPlan` can run millions of times.

## Performance

The cost grows with outer rows × inner cost. An index on the correlated column, such as `orders(customer_id)`, keeps it acceptable. For large data, prefer a `JOIN` to a pre-aggregated derived table, a CTE, or a window function.

## Interview questions

### What makes a subquery correlated?

It references a column from the outer query, so its result depends on the current outer row.

### How would you rewrite a correlated "above group average" query?

Join to a `GROUP BY` derived table of averages, or use `AVG(...) OVER (PARTITION BY ...)` and filter in an outer query.

### Is a correlated subquery always slow?

No. With an index on the correlation key it can be fast, and PostgreSQL turns `EXISTS` into a semi-join. Scalar subqueries in `SELECT` are run for each row.

### Why might a correlated `COUNT` subquery be better than a `LEFT JOIN` + `GROUP BY`?

It returns 0 for rows with no matches and does not multiply rows when there are several one-to-many joins.

## Quick revision

- It references outer columns, so it runs logically once per outer row.
- It shows as a `SubPlan` in `EXPLAIN`.
- It is ideal for "compared with its own group" filters.
- Index the correlation column.
- Rewrite options are JOIN + GROUP BY, a window function or `LATERAL`.
- Always qualify columns with aliases.
