---
title: Orders missing a successful payment
slug: orders-without-payment
dataset: ecommerce
difficulty: Easy
description: Reconcile orders against the payments system and list orders that never received a successful payment, with their attempts.
notes: [left-join, exists-not-exists, filter-clause]
patterns: [anti-join, missing-records, unmatched-records]
---

## Business context
The order system and the payment gateway are separate systems. Finance wants to know which orders have no successful payment on record so they can stop fulfilment or chase the customer, and how many failed attempts each one had.

## Problem
List every order that has no payment with `status = 'success'`, showing its status, order value and how many payment attempts (of any status) it has.

## Available data
- `orders`: `order_id`, `user_id`, `status`
- `order_items`: `order_id`, `quantity`, `unit_price`
- `payments`: `payment_id`, `order_id`, `status`

## Expected outcome
Pending orders get a payment reminder; cancelled ones are confirmed closed; anything else would be escalated as a fulfilment risk.

## Success criteria
- Output columns, exactly: `order_id`, `user_id`, `status`, `order_total`, `payment_attempts`
- `order_total` = sum of `quantity * unit_price`, rounded with `ROUND(x::numeric, 2)`; 0 if an order has no items.
- `payment_attempts` counts all payment rows for the order (0 when none).
- Include every order status.

```solution
SELECT o.order_id, o.user_id, o.status,
       ROUND(COALESCE((SELECT SUM(i.quantity * i.unit_price) FROM order_items i WHERE i.order_id = o.order_id), 0)::numeric, 2) AS order_total,
       (SELECT COUNT(*) FROM payments p WHERE p.order_id = o.order_id) AS payment_attempts
FROM orders o
WHERE NOT EXISTS (
  SELECT 1 FROM payments p WHERE p.order_id = o.order_id AND p.status = 'success'
);
```

```alternative
WITH pay AS (
  SELECT order_id, COUNT(*) AS attempts, COUNT(*) FILTER (WHERE status = 'success') AS successes
  FROM payments
  GROUP BY order_id
),
tot AS (
  SELECT order_id, SUM(quantity * unit_price) AS total
  FROM order_items
  GROUP BY order_id
)
SELECT o.order_id, o.user_id, o.status,
       ROUND(COALESCE(t.total, 0)::numeric, 2) AS order_total,
       COALESCE(p.attempts, 0) AS payment_attempts
FROM orders o
LEFT JOIN pay p ON p.order_id = o.order_id
LEFT JOIN tot t ON t.order_id = o.order_id
WHERE COALESCE(p.successes, 0) = 0;
```

## Explanation
This is an anti-join: keep orders for which no matching successful payment exists. `NOT EXISTS` states it directly. The alternative pre-aggregates payments per order with a `FILTER` count of successes and keeps orders where that count is zero or the order has no payment row at all (NULL after the LEFT JOIN). Aggregating items and payments in separate CTEs avoids the fan-out you would get by joining both to orders at once.

## Follow-up questions
### How do you check the other direction, payments without an order?
`SELECT * FROM payments p WHERE NOT EXISTS (SELECT 1 FROM orders o WHERE o.order_id = p.order_id)`; here the foreign key guarantees it is empty, but in two real systems it often is not.
### Why not use NOT IN?
`NOT IN` returns no rows if the subquery yields a NULL `order_id`; `NOT EXISTS` is NULL-safe.
