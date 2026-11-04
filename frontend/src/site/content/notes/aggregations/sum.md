---
title: SUM
slug: sum
category: aggregations
difficulty: Beginner
description: Use SUM to total numeric values in SQL, compute revenue from line items, handle NULL results with COALESCE and avoid join double counting.
prerequisites: [select, count]
related: [avg, group-by, conditional-aggregation, running-totals, null-handling]
questions: [1, 2, 3, 11, 27, 31]
patterns: [running-total, pivot-report]
guides: [aggregate-functions]
minutes: 7
version: 1
---

## Introduction

`SUM` totals numbers. In Northwind it is how you compute revenue, quantity sold and freight costs.

## Definition

`SUM(expr)` returns the sum of all non-NULL values of `expr` in a group. If every value is NULL, or there are no rows, it returns NULL.

## Why it matters

Revenue reports, top-N customers and category totals are the most common interview queries. They all use `SUM` over an expression such as `unit_price * quantity * (1 - discount)`.

## How it works

For each group, `SUM` adds the non-NULL values. NULLs are skipped, not treated as 0. An empty group produces NULL, so wrap it in `COALESCE` when you need 0.

## Syntax

```sql-syntax
SELECT SUM(expression) FROM table_name;
SELECT group_col, SUM(expression) FROM table_name GROUP BY group_col;
SELECT COALESCE(SUM(expression), 0) FROM table_name;
```

## Simple examples

Total freight across all orders:

```sql
SELECT SUM(freight) AS total_freight FROM orders;
```

Total units in stock:

```sql
SELECT SUM(units_in_stock) AS units FROM products;
```

## Intermediate examples

Revenue per product, using the price at sale time from `order_details`:

```sql
SELECT p.product_name,
       ROUND(SUM(od.unit_price * od.quantity * (1 - od.discount))::numeric, 2) AS revenue
FROM order_details od
JOIN products p ON p.product_id = od.product_id
GROUP BY p.product_name
ORDER BY revenue DESC
LIMIT 5;
```

Revenue per category:

```sql
SELECT c.category_name,
       ROUND(SUM(od.unit_price * od.quantity * (1 - od.discount))::numeric, 2) AS revenue
FROM order_details od
JOIN products p   ON p.product_id = od.product_id
JOIN categories c ON c.category_id = p.category_id
GROUP BY c.category_name
ORDER BY revenue DESC;
```

## Advanced examples

Quantity sold per product including never-ordered products. `SUM` over no matches is NULL, so `COALESCE` turns it into 0.

```sql
SELECT p.product_id,
       SUM(od.quantity)              AS raw_sum,
       COALESCE(SUM(od.quantity), 0) AS quantity_sold
FROM products p
LEFT JOIN order_details od ON od.product_id = p.product_id
WHERE p.product_id IN (9, 17, 1)
GROUP BY p.product_id
ORDER BY p.product_id;
```

Double counting trap: summing `freight` after joining line items repeats each order's freight once per line. Aggregate at the order level first.

```sql
SELECT
  (SELECT SUM(freight) FROM orders) AS correct_freight,
  (SELECT SUM(o.freight)
   FROM orders o JOIN order_details od ON od.order_id = o.order_id) AS inflated_freight;
```

## Real-world scenarios

- Revenue by customer, employee, shipper or month.
- Percent of total: `SUM(x) / SUM(SUM(x)) OVER ()`.
- Conditional totals: `SUM(CASE WHEN ... THEN amount END)`.

## PostgreSQL specifics

- In PostgreSQL, `SUM` of `integer` returns `bigint`, of `numeric` returns `numeric`, and of `real` returns `real`.
- `discount` is `real`, so revenue expressions become `double precision`. Cast to `numeric` before `ROUND(x, 2)`; PostgreSQL has no two-argument `ROUND` for `double precision`.
- `SUM(DISTINCT x)` is allowed but rarely what you want.

## Visual explanation

```text
quantity: 10, NULL, 5, 20
SUM      = 10 + 5 + 20 = 35   (NULL skipped)
no rows  -> SUM = NULL        -> COALESCE(SUM, 0) = 0
```

## Common mistakes

- Using `products.unit_price` (current price) instead of `order_details.unit_price` (price at sale).
- Forgetting `COALESCE` after a `LEFT JOIN`.
- Summing an order-level column after joining a detail table.
- Calling `ROUND(double precision, 2)` in PostgreSQL: it errors.

## Performance

- `SUM` is a single pass; cost is dominated by scanning and joining.
- Pre-aggregate detail rows in a CTE or subquery before joining to wide dimension tables.
- `numeric` sums are slower than integer or float sums but exact.

## Interview questions

### What does SUM return when all values are NULL?

NULL. Use `COALESCE(SUM(x), 0)` to get 0.

### Does SUM treat NULL as zero?

No. It skips NULLs. The result matches treating them as 0 only when at least one value is non-NULL.

### Why can SUM after a join give an inflated total?

A one-to-many join repeats parent rows. Summing a parent column then counts it once per child row.

### How do you compute revenue in Northwind?

`SUM(od.unit_price * od.quantity * (1 - od.discount))` from `order_details`.

## Quick revision

- `SUM` skips NULLs.
- Empty or all-NULL input returns NULL.
- Use `COALESCE(SUM(x), 0)` for zero-filled reports.
- Revenue uses the sale-time price in `order_details`.
- Watch one-to-many joins for double counting.
- Cast to `numeric` before `ROUND(x, 2)` in PostgreSQL.
