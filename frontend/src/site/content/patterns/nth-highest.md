---
title: Nth highest value
slug: nth-highest
category: ranking
difficulty: Intermediate
description: Return the Nth highest distinct value with DENSE_RANK, OFFSET N-1, or a correlated COUNT, and choose how ties are treated.
questions: [148, 149, 14]
notes: [dense-rank, rank, limit-offset, correlated-subqueries]
guides: [nth-highest-value, rank-vs-dense-rank-vs-row-number]
---

## Problem

Return the Nth highest distinct value of a column, for any N. Northwind has no salary column, so the examples use employee revenue (sum of order lines per employee) and `products.unit_price`. Here N = 3.

## When to use it

- "Nth highest salary" interview questions.
- The 3rd best month, product or employee by a metric.
- Leaderboards where ties share a position.

## Solution

Third highest employee revenue:

```sql
WITH emp_revenue AS (
  SELECT o.employee_id,
         ROUND(SUM(od.unit_price * od.quantity * (1 - od.discount))::numeric, 2) AS revenue
  FROM orders o
  JOIN order_details od ON od.order_id = o.order_id
  WHERE o.employee_id IS NOT NULL
  GROUP BY o.employee_id
),
ranked AS (
  SELECT employee_id, revenue,
         DENSE_RANK() OVER (ORDER BY revenue DESC) AS rnk
  FROM emp_revenue
)
SELECT employee_id, revenue
FROM ranked
WHERE rnk = 3;
```

## Alternatives

`OFFSET N-1` over distinct values:

```sql
SELECT DISTINCT unit_price
FROM products
ORDER BY unit_price DESC
LIMIT 1 OFFSET 2;
```

Correlated count, which is portable and works without window functions: a value is Nth highest when exactly N-1 distinct values are larger.

```sql
SELECT DISTINCT p.unit_price
FROM products p
WHERE (SELECT COUNT(DISTINCT p2.unit_price)
       FROM products p2
       WHERE p2.unit_price > p.unit_price) = 2;
```

`DENSE_RANK` returns details for every tied row. `OFFSET` is the shortest but needs a literal or a parameter, and returns no row when N is too large. The correlated count is O(n²) and only suits small tables.

## How it works

`DENSE_RANK` numbers distinct values 1, 2, 3, … from the top, with ties sharing a number and no gaps. Filtering on `rnk = N` returns the Nth distinct value. The filter must sit in an outer query, because window functions run after `WHERE`.

## Execution walkthrough

1. `emp_revenue` sums line revenue per employee and skips the order with no employee.
2. `ranked` sorts employees by revenue, highest first, and assigns dense ranks.
3. The outer query keeps rank 3.
4. Two employees tied at rank 3 would both be returned.

## Common mistakes

- `WHERE DENSE_RANK() OVER (…) = 3` in the same query. Window functions are not allowed in `WHERE`.
- `ROW_NUMBER` instead of `DENSE_RANK`. Ties then get different numbers, so the Nth row is not the Nth value.
- `OFFSET N` instead of `OFFSET N-1`.

## Performance

The window version sorts all rows once. `OFFSET` with an index on the column reads only N index entries. Avoid the correlated count on large tables.
