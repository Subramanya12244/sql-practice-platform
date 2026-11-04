---
title: Customers whose purchases declined
slug: declining-customers
dataset: northwind
difficulty: Medium
description: Find customers who spent less in 1998 than in 1997, including customers who stopped buying entirely.
orderBy: revenue_change, customer_id
notes: [conditional-aggregation, sum, left-join]
patterns: [conditional-aggregation, year-over-year-growth]
---

## Business context
The account management team wants to call customers whose spending is slipping before they churn completely. They want a simple year-on-year comparison of calendar 1997 against calendar 1998.

## Problem
List every customer who bought something in 1997 and whose 1998 revenue was lower. Customers who bought nothing at all in 1998 count as declined (their 1998 revenue is 0).

## Available data
- `orders`: `order_id`, `customer_id`, `order_date`
- `order_details`: `order_id`, `unit_price`, `quantity`, `discount`
- `customers`: `customer_id`, `company_name`

## Expected outcome
Account managers get a call list sorted by the biggest drop first.

## Success criteria
- Output columns, exactly: `customer_id`, `company_name`, `revenue_1997`, `revenue_1998`, `revenue_change`
- Line revenue = `unit_price * quantity * (1 - discount)`, with `discount` cast to numeric.
- Round all money columns to 2 decimals with `ROUND(x::numeric, 2)`; `revenue_change` = 1998 minus 1997 (negative).
- A customer with no 1998 orders shows `0.00` for `revenue_1998`.
- Sort by `revenue_change` ascending, then `customer_id`.

```solution
WITH rev AS (
  SELECT o.customer_id,
         SUM(CASE WHEN o.order_date >= DATE '1997-01-01' AND o.order_date < DATE '1998-01-01'
                  THEN od.unit_price * od.quantity * (1 - od.discount::numeric) ELSE 0 END) AS r97,
         SUM(CASE WHEN o.order_date >= DATE '1998-01-01' AND o.order_date < DATE '1999-01-01'
                  THEN od.unit_price * od.quantity * (1 - od.discount::numeric) ELSE 0 END) AS r98
  FROM orders o
  JOIN order_details od ON od.order_id = o.order_id
  GROUP BY o.customer_id
)
SELECT c.customer_id, c.company_name,
       ROUND(r.r97::numeric, 2) AS revenue_1997,
       ROUND(r.r98::numeric, 2) AS revenue_1998,
       ROUND((r.r98 - r.r97)::numeric, 2) AS revenue_change
FROM rev r
JOIN customers c ON c.customer_id = r.customer_id
WHERE r.r97 > 0 AND r.r98 < r.r97
ORDER BY revenue_change, c.customer_id;
```

```alternative
WITH lines AS (
  SELECT o.customer_id, o.order_date,
         od.unit_price * od.quantity * (1 - od.discount::numeric) AS amount
  FROM orders o JOIN order_details od ON od.order_id = o.order_id
),
y97 AS (
  SELECT customer_id, SUM(amount) AS r97 FROM lines
  WHERE order_date >= DATE '1997-01-01' AND order_date < DATE '1998-01-01'
  GROUP BY customer_id
),
y98 AS (
  SELECT customer_id, SUM(amount) AS r98 FROM lines
  WHERE order_date >= DATE '1998-01-01' AND order_date < DATE '1999-01-01'
  GROUP BY customer_id
)
SELECT c.customer_id, c.company_name,
       ROUND(y97.r97::numeric, 2) AS revenue_1997,
       ROUND(COALESCE(y98.r98, 0)::numeric, 2) AS revenue_1998,
       ROUND((COALESCE(y98.r98, 0) - y97.r97)::numeric, 2) AS revenue_change
FROM y97
LEFT JOIN y98 ON y98.customer_id = y97.customer_id
JOIN customers c ON c.customer_id = y97.customer_id
WHERE COALESCE(y98.r98, 0) < y97.r97
ORDER BY revenue_change, c.customer_id;
```

## Explanation
Conditional aggregation computes both periods in one pass, with `ELSE 0` so a missing period becomes zero instead of NULL. The alternative builds each period separately and uses a LEFT JOIN from the base period, so customers who vanished in 1998 survive the join and `COALESCE` turns their NULL into 0. An inner join there would silently drop the customers you most need to call.

## Follow-up questions
### How would you show the percentage drop instead?
Divide `r98 - r97` by `r97` (safe because `r97 > 0` is required) and multiply by 100 before rounding.
### How would you also catch customers who are new in 1998?
Swap the LEFT JOIN for a FULL OUTER JOIN and COALESCE both sides; new customers have 0 in 1997 and a positive change.
