---
title: AVG
slug: avg
category: aggregations
difficulty: Beginner
description: How SQL AVG computes means, why NULLs change the result, integer averages in PostgreSQL, and averages of aggregates like average order value.
prerequisites: [sum, count]
related: [sum, min-max, group-by, scalar-subqueries, moving-averages]
questions: [6, 7, 8, 40, 113, 133]
patterns: [moving-average]
guides: [aggregate-functions]
minutes: 7
version: 1
---

## Introduction

`AVG` returns the arithmetic mean. Interviews use it in "above average" questions and in average order value, which needs two levels of aggregation.

## Definition

`AVG(expr)` returns `SUM(expr) / COUNT(expr)` over the non-NULL values in a group. With no non-NULL values it returns NULL.

## Why it matters

"Customers above average revenue" and "average days to ship" are classic questions. Getting the denominator right (which rows, NULLs or not) is the whole point.

## How it works

NULLs are excluded from both the sum and the count. So `AVG(x)` is not the same as `SUM(x) / COUNT(*)` when `x` has NULLs.

## Syntax

```sql-syntax
SELECT AVG(expression) FROM table_name;
SELECT group_col, AVG(expression) FROM table_name GROUP BY group_col;
SELECT AVG(COALESCE(expression, 0)) FROM table_name;   -- treat NULL as 0
```

## Simple examples

Average product price:

```sql
SELECT ROUND(AVG(unit_price), 2) AS avg_price FROM products;
```

Average freight per shipper:

```sql
SELECT ship_via, ROUND(AVG(freight), 2) AS avg_freight
FROM orders
GROUP BY ship_via
ORDER BY ship_via;
```

## Intermediate examples

Average days to ship per shipper, ignoring unshipped orders (date subtraction gives an integer in PostgreSQL):

```sql
SELECT s.company_name,
       ROUND(AVG(o.shipped_date - o.order_date), 1) AS avg_days_to_ship
FROM orders o
JOIN shippers s ON s.shipper_id = o.ship_via
WHERE o.shipped_date IS NOT NULL
GROUP BY s.company_name
ORDER BY avg_days_to_ship;
```

Products priced above the overall average, using a scalar subquery:

```sql
SELECT product_name, unit_price
FROM products
WHERE unit_price > (SELECT AVG(unit_price) FROM products)
ORDER BY unit_price DESC
LIMIT 5;
```

## Advanced examples

Average order value: sum lines per order first, then average the order totals. `AVG` over raw lines gives average line value instead.

```sql
WITH order_totals AS (
  SELECT order_id,
         SUM(unit_price * quantity * (1 - discount))::numeric AS total
  FROM order_details
  GROUP BY order_id
)
SELECT ROUND(AVG(total), 2) AS avg_order_value,
       (SELECT ROUND(AVG(unit_price * quantity * (1 - discount))::numeric, 2)
        FROM order_details) AS avg_line_value
FROM order_totals;
```

Customers whose revenue beats the average customer revenue:

```sql
WITH cust AS (
  SELECT o.customer_id,
         SUM(od.unit_price * od.quantity * (1 - od.discount))::numeric AS revenue
  FROM orders o
  JOIN order_details od ON od.order_id = o.order_id
  GROUP BY o.customer_id
)
SELECT customer_id, ROUND(revenue, 2) AS revenue
FROM cust
WHERE revenue > (SELECT AVG(revenue) FROM cust)
ORDER BY revenue DESC
LIMIT 5;
```

## Real-world scenarios

- Average order value (AOV) per customer or month.
- Average shipping delay per carrier.
- Benchmarking: rows above or below the group average.

## PostgreSQL specifics

- In PostgreSQL, `AVG` of an `integer` column returns `numeric`, so there is no integer truncation. Plain division `SUM(i) / COUNT(i)` does truncate.
- `AVG` of `real` or `double precision` returns `double precision`.
- Aggregates cannot be nested directly: `AVG(SUM(x))` is an error. Use a CTE, a subquery or `AVG(SUM(x)) OVER ()`.

## Visual explanation

```text
values: 10, 20, NULL
AVG(x)              = (10 + 20) / 2 = 15
SUM(x) / COUNT(*)   = 30 / 3        = 10
AVG(COALESCE(x, 0)) = 30 / 3        = 10
```

## Common mistakes

- Averaging line items when the question asks for average order value.
- Nesting `AVG(SUM(...))` in one `SELECT`.
- Forgetting that NULLs are excluded from the denominator.
- Writing `SUM(int) / COUNT(*)` and getting integer division.

## Performance

- `AVG` costs the same as `SUM` plus a counter.
- For "above average" filters, compute the average once (CTE or scalar subquery), not per row.

## Interview questions

### How does AVG handle NULLs?

It ignores them in both numerator and denominator. Use `AVG(COALESCE(x, 0))` to treat them as zero.

### How do you compute average order value?

Aggregate lines to one total per order, then take `AVG` of those totals.

### Can you write AVG(SUM(x))?

Not in a plain `SELECT`. Aggregate in a subquery or CTE first, or use a window: `AVG(SUM(x)) OVER ()`.

### What type does AVG return on an integer column in PostgreSQL?

`numeric`.

## Quick revision

- `AVG` = sum of non-NULL values / count of non-NULL values.
- NULLs shrink the denominator.
- Average of totals needs two aggregation levels.
- No nested aggregates; use a CTE.
- PostgreSQL returns `numeric` for integer input.
- Compare to the average with a scalar subquery or CTE.
