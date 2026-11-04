---
title: Detect duplicate card payments
slug: duplicate-payments
dataset: ecommerce
difficulty: Medium
description: Find orders that were charged more than once for the same amount and work out how much must be refunded.
orderBy: order_id
notes: [group-by, having, count, partition-by]
patterns: [find-duplicates]
---

## Business context
Customer support has received complaints about double charges. The payments team wants every order that has more than one successful payment of the same amount, and the amount that should be refunded to each customer.

## Problem
Group successful payments by order and amount. Report each group with more than one payment, and the overcharge (every payment beyond the first).

## Available data
- `payments`: `payment_id`, `order_id`, `amount`, `method`, `status` (`success`, `failed`, `refunded`), `paid_at`

## Expected outcome
The payments team issues a refund of `overcharge_amount` for each listed order.

## Success criteria
- Output columns, exactly: `order_id`, `amount`, `success_payment_count`, `overcharge_amount`
- Only `status = 'success'` payments count; failed and refunded rows are ignored.
- `overcharge_amount` = `amount * (success_payment_count - 1)`, rounded with `ROUND(x::numeric, 2)`.
- Sort by `order_id`.

```solution
SELECT order_id, amount,
       COUNT(*) AS success_payment_count,
       ROUND((amount * (COUNT(*) - 1))::numeric, 2) AS overcharge_amount
FROM payments
WHERE status = 'success'
GROUP BY order_id, amount
HAVING COUNT(*) > 1
ORDER BY order_id;
```

```alternative
SELECT DISTINCT order_id, amount, cnt AS success_payment_count,
       ROUND((amount * (cnt - 1))::numeric, 2) AS overcharge_amount
FROM (
  SELECT order_id, amount, COUNT(*) OVER (PARTITION BY order_id, amount) AS cnt
  FROM payments
  WHERE status = 'success'
) p
WHERE cnt > 1
ORDER BY order_id;
```

## Explanation
Duplicate detection is a GROUP BY on the columns that should be unique together, with `HAVING COUNT(*) > 1`. The window version tags every payment with its group size, which is handy when you want the individual payment ids (drop the `DISTINCT` and select `payment_id`). Filtering on `status = 'success'` matters: an order with a failed attempt followed by a success is normal, not a double charge.

## Follow-up questions
### Which payment ids should be refunded?
Use `ROW_NUMBER() OVER (PARTITION BY order_id, amount ORDER BY paid_at, payment_id)` and refund rows with `rn > 1`.
### What about refunded orders that also have a success row?
Those are a separate `refunded` row, so the success count stays 1 and they are not flagged.
