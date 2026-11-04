---
title: Inactive customers
slug: inactive-customers
category: latest
difficulty: Intermediate
description: Find customers with no orders in the last N months relative to a reference date, including never-ordered customers, using MAX(order_date) and LEFT JOIN.
questions: [118, 26, 28]
notes: [left-join, min-max, date-time-functions, exists-not-exists]
guides: [date-functions-postgresql, left-join]
---

## Problem

Find customers who have not ordered in the last 6 months, including customers who never ordered. In real systems the reference date is `CURRENT_DATE`. Northwind's orders are historical, so these examples use the latest order date in the data as "today".

## When to use it

- Churn and win-back campaigns.
- Flagging dormant accounts.
- Retention reports.

## Solution

```sql
WITH ref AS (
  SELECT MAX(order_date) AS today FROM orders
),
last_order AS (
  SELECT c.customer_id, MAX(o.order_date) AS last_order_date
  FROM customers c
  LEFT JOIN orders o ON o.customer_id = c.customer_id
  GROUP BY c.customer_id
)
SELECT l.customer_id, l.last_order_date,
       r.today - l.last_order_date AS days_inactive
FROM last_order l
CROSS JOIN ref r
WHERE l.last_order_date IS NULL
   OR l.last_order_date < r.today - interval '6 months'
ORDER BY l.last_order_date NULLS FIRST, l.customer_id;
```

## Alternatives

`NOT EXISTS` with a time window: no order in the window, whatever happened before:

```sql
SELECT c.customer_id, c.company_name
FROM customers c
WHERE NOT EXISTS (
  SELECT 1
  FROM orders o
  WHERE o.customer_id = c.customer_id
    AND o.order_date >= (SELECT MAX(order_date) FROM orders) - interval '6 months'
)
ORDER BY c.customer_id;
```

Previously active but now inactive (excludes customers who never ordered):

```sql
SELECT customer_id, MAX(order_date) AS last_order_date
FROM orders
GROUP BY customer_id
HAVING MAX(order_date) < (SELECT MAX(order_date) FROM orders) - interval '6 months'
ORDER BY last_order_date;
```

The `NOT EXISTS` form can use an index on `(customer_id, order_date)` and stops at the first recent order. The `HAVING` form answers "churned" (once active), while the solution answers "inactive" (including never active).

## How it works

`MAX(order_date)` per customer gives the last activity. The `LEFT JOIN` keeps customers without orders, whose maximum is NULL. A customer is inactive when the last order is older than the cutoff (`today - 6 months`) or does not exist.

## Execution walkthrough

1. `ref` finds the reference date.
2. `last_order` returns one row per customer with the last order date, NULL for FISSA and PARIS.
3. The `WHERE` keeps NULLs and dates before the cutoff.
4. `date - date` gives days inactive. It is NULL for customers who never ordered.
5. `NULLS FIRST` lists never-ordered customers first.

## Common mistakes

- Forgetting `OR … IS NULL`, which silently drops customers who never ordered. `NULL < date` is not true.
- Using an `INNER JOIN`, with the same effect.
- Using `CURRENT_DATE` on historical sample data, which flags everyone.
- Comparing `date - 180` with "6 months". Month lengths vary, so `interval '6 months'` is more exact.

## Performance

An index on `orders (customer_id, order_date)` lets PostgreSQL find each customer's latest order quickly. On large tables keep a `last_order_date` column or materialized view.
