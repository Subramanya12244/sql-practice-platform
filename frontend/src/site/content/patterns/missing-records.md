---
title: Missing records
slug: missing-records
category: missing
difficulty: Intermediate
description: Find expected values that have no row, such as months without orders or products never sold, using generate_series or a reference table with a LEFT JOIN.
questions: [29, 30, 27, 110]
notes: [left-join, exists-not-exists, date-time-functions, null-handling]
guides: [left-join]
---

## Problem

Find values that should exist but have no row. Examples: months with no orders, product ids never sold, or ids missing from a sequence. The trick is to build the full list of expected values, then subtract the ones that exist.

## When to use it

- Reports that must show zero for empty months or days.
- Finding gaps in an id sequence.
- Finding catalogue items with no activity.

## Solution

Every month from the first to the last order month, with the order count, including zero months:

```sql
WITH months AS (
  SELECT generate_series(
           date_trunc('month', MIN(order_date)),
           date_trunc('month', MAX(order_date)),
           interval '1 month')::date AS month
  FROM orders
)
SELECT m.month, COUNT(o.order_id) AS orders
FROM months m
LEFT JOIN orders o
  ON date_trunc('month', o.order_date) = m.month
GROUP BY m.month
ORDER BY orders, m.month
LIMIT 10;
```

## Alternatives

Missing ids in a sequence (products 1 to the highest id that have no order line):

```sql
SELECT s.id AS product_id
FROM generate_series(1, (SELECT MAX(product_id) FROM products)) AS s(id)
WHERE NOT EXISTS (
  SELECT 1 FROM order_details od WHERE od.product_id = s.id
);
```

Using a real reference table instead of a generated list:

```sql
SELECT p.product_id, p.product_name
FROM products p
EXCEPT
SELECT p.product_id, p.product_name
FROM products p
JOIN order_details od ON od.product_id = p.product_id;
```

`generate_series` is PostgreSQL-specific. Other databases use a calendar table or a recursive CTE. A calendar or numbers table is the most portable choice and can be indexed.

## How it works

The left side holds every expected value. A `LEFT JOIN` keeps each one, and the right side is NULL where no row exists. `COUNT(o.order_id)` counts only non-NULL values, so empty months show 0. `NOT EXISTS` and `EXCEPT` return only the expected values with no match.

## Execution walkthrough

1. The CTE finds the first and last order months and generates one date per month between them.
2. `LEFT JOIN` attaches the orders of each month. Months without orders get one row with NULL order columns.
3. `GROUP BY m.month` with `COUNT(o.order_id)` gives 0 for those rows.
4. `ORDER BY orders` puts the emptiest months first.

## Common mistakes

- `COUNT(*)` instead of `COUNT(o.order_id)`. `COUNT(*)` counts the NULL-extended row, so empty months show 1.
- Filtering the right table in `WHERE` (`WHERE o.ship_country = 'USA'`). That removes the NULL rows and turns the join into an inner join. Put the filter in `ON`.
- Joining on `order_date = month`. Only orders on the first of the month match. Truncate the order date first, or use a range.

## Performance

Joining on `date_trunc('month', order_date)` cannot use a plain index on `order_date`. For large tables join on a range (`o.order_date >= m.month AND o.order_date < m.month + interval '1 month'`) so an index can be used. A permanent calendar table avoids generating the series in every query.
