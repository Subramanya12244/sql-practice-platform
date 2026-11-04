---
title: Detect duplicated orders
slug: duplicate-orders
dataset: sales
difficulty: Hard
description: Find orders re-entered with a new id: same customer, same date and identical order lines as an earlier order.
orderBy: duplicate_order_id
notes: [string-functions, partition-by, self-join]
patterns: [find-duplicates, remove-duplicates]
---

## Business context
The finance team noticed revenue that looks too high and suspects the order-entry integration replayed some orders, creating copies with new order numbers. They need a list of the copies so they can be voided, along with the original each one duplicates.

## Problem
Two orders are duplicates when they have the same customer, the same order date and exactly the same set of order lines (product, quantity, unit price and discount). Within each group of duplicates, the order with the lowest id is the original; report every other order in the group.

## Available data
- `orders`: `order_id`, `customer_id`, `order_date`
- `order_items`: `order_id`, `product_id`, `quantity`, `unit_price`, `discount`

## Expected outcome
Finance voids each `duplicate_order_id` and credits back any revenue booked on it.

## Success criteria
- Output columns, exactly: `original_order_id`, `duplicate_order_id`, `customer_id`, `order_date`
- Lines must match exactly on `product_id`, `quantity`, `unit_price` and `discount`, with the same number of lines.
- `original_order_id` is the lowest `order_id` in the duplicate group; the original itself is not listed as a duplicate.
- Sort by `duplicate_order_id`.

```solution
WITH sig AS (
  SELECT o.order_id, o.customer_id, o.order_date,
         string_agg(i.product_id || ':' || i.quantity || ':' || i.unit_price || ':' || i.discount, ','
                    ORDER BY i.product_id, i.quantity, i.unit_price, i.discount) AS lines
  FROM orders o
  JOIN order_items i ON i.order_id = o.order_id
  GROUP BY o.order_id, o.customer_id, o.order_date
),
grp AS (
  SELECT *, MIN(order_id) OVER (PARTITION BY customer_id, order_date, lines) AS original_order_id
  FROM sig
)
SELECT original_order_id, order_id AS duplicate_order_id, customer_id, order_date
FROM grp
WHERE order_id <> original_order_id
ORDER BY duplicate_order_id;
```

```alternative
WITH pairs AS (
  SELECT a.order_id AS a_id, b.order_id AS b_id, a.customer_id, a.order_date
  FROM orders a
  JOIN orders b
    ON b.customer_id = a.customer_id AND b.order_date = a.order_date AND b.order_id > a.order_id
  WHERE NOT EXISTS (
          (SELECT product_id, quantity, unit_price, discount FROM order_items WHERE order_id = a.order_id
           EXCEPT ALL
           SELECT product_id, quantity, unit_price, discount FROM order_items WHERE order_id = b.order_id)
          UNION ALL
          (SELECT product_id, quantity, unit_price, discount FROM order_items WHERE order_id = b.order_id
           EXCEPT ALL
           SELECT product_id, quantity, unit_price, discount FROM order_items WHERE order_id = a.order_id))
    AND EXISTS (SELECT 1 FROM order_items WHERE order_id = a.order_id)
)
SELECT p.a_id AS original_order_id, p.b_id AS duplicate_order_id, p.customer_id, p.order_date
FROM pairs p
WHERE NOT EXISTS (SELECT 1 FROM pairs q WHERE q.b_id = p.a_id)
ORDER BY duplicate_order_id;
```

## Explanation
An order's "content" spans several rows, so first reduce each order to a comparable value: a sorted, delimited signature of its lines. Orders sharing customer, date and signature are duplicates, and `MIN(order_id) OVER (...)` names the original. The alternative compares orders pairwise with a two-way `EXCEPT ALL` (empty in both directions means identical multisets of lines), then keeps only pairs whose left side is not itself a duplicate of an even earlier order.

## Follow-up questions
### How much revenue do the duplicates add?
Join the duplicate ids to `order_items` and sum `quantity * unit_price * (1 - discount)`.
### Why include the discount in the signature?
Two orders for the same products at different discounts are genuinely different deals, not a replay.
