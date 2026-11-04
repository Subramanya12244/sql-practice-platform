---
title: Win back inactive customers
slug: inactive-customers
dataset: sales
difficulty: Easy
description: Find customers who have ordered before but placed no order in the 180 days up to the latest order date in the data.
orderBy: days_inactive, customer_id
notes: [min-max, having, exists-not-exists]
patterns: [inactive-customers]
---

## Business context
Marketing is launching a win-back campaign for B2B accounts that have gone quiet. They only want customers who have bought from us at least once; prospects who never ordered are handled by a different team.

## Problem
Using the most recent order date in the data as "today", list customers whose last order (of any status) is more than 180 days before that date.

## Available data
- `customers`: `customer_id`, `company_name`
- `orders`: `order_id`, `customer_id`, `order_date`, `status`

## Expected outcome
The campaign team sends the longest-inactive accounts a discount offer first.

## Success criteria
- Output columns, exactly: `customer_id`, `company_name`, `last_order_date`, `days_inactive`
- Anchor date = `MAX(order_date)` over all orders (not `CURRENT_DATE`).
- `days_inactive` = anchor date minus `last_order_date` (integer days); include a customer only when it is greater than 180.
- Customers with no orders at all are excluded. Every order status counts as activity.
- Sort by `days_inactive` descending, then `customer_id`.

```solution
WITH anchor AS (SELECT MAX(order_date) AS as_of FROM orders),
last_order AS (
  SELECT customer_id, MAX(order_date) AS last_order_date
  FROM orders
  GROUP BY customer_id
)
SELECT c.customer_id, c.company_name, l.last_order_date,
       a.as_of - l.last_order_date AS days_inactive
FROM last_order l
JOIN customers c ON c.customer_id = l.customer_id
CROSS JOIN anchor a
WHERE a.as_of - l.last_order_date > 180
ORDER BY days_inactive DESC, c.customer_id;
```

```alternative
SELECT c.customer_id, c.company_name,
       (SELECT MAX(o.order_date) FROM orders o WHERE o.customer_id = c.customer_id) AS last_order_date,
       (SELECT MAX(order_date) FROM orders)
         - (SELECT MAX(o.order_date) FROM orders o WHERE o.customer_id = c.customer_id) AS days_inactive
FROM customers c
WHERE EXISTS (SELECT 1 FROM orders o WHERE o.customer_id = c.customer_id)
  AND NOT EXISTS (
    SELECT 1 FROM orders o
    WHERE o.customer_id = c.customer_id
      AND o.order_date >= (SELECT MAX(order_date) FROM orders) - 180
  )
ORDER BY days_inactive DESC, c.customer_id;
```

## Explanation
Compute each customer's last order date, then compare it with a fixed anchor taken from the data so the answer does not change with the calendar. The alternative phrases inactivity as "has ordered, but has no order on or after anchor - 180 days" with `EXISTS` / `NOT EXISTS`. Subtracting two `DATE` values in PostgreSQL yields an integer number of days.

## Follow-up questions
### Why not use CURRENT_DATE?
The dataset ends on a fixed date; with CURRENT_DATE every customer eventually looks inactive and results are not reproducible.
### How would you include customers who never ordered?
LEFT JOIN customers to `last_order` and treat a NULL `last_order_date` as inactive, reporting them in a separate bucket.
