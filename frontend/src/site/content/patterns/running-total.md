---
title: Running total
slug: running-total
category: running
difficulty: Intermediate
description: Compute cumulative sums with SUM() OVER (ORDER BY … ROWS UNBOUNDED PRECEDING), per group with PARTITION BY, and avoid RANGE tie surprises.
questions: [101, 119, 105]
notes: [running-totals, window-order-by, partition-by, sum]
guides: [running-total]
---

## Problem

Add each row's value to the total of all previous rows, for example cumulative monthly revenue.

## When to use it

- Year-to-date or cumulative revenue.
- Account balances from a list of transactions.
- Pareto analysis (the share of revenue reached by the top customers).

## Solution

```sql
WITH monthly AS (
  SELECT date_trunc('month', o.order_date)::date AS month,
         SUM(od.unit_price * od.quantity * (1 - od.discount)) AS revenue
  FROM orders o
  JOIN order_details od ON od.order_id = o.order_id
  GROUP BY 1
)
SELECT month,
       ROUND(revenue::numeric, 2) AS revenue,
       ROUND(SUM(revenue) OVER (ORDER BY month
                                ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW)::numeric, 2) AS running_total
FROM monthly
ORDER BY month;
```

## Alternatives

Restart the total for each group with `PARTITION BY` (freight per customer):

```sql
SELECT customer_id, order_id, order_date, freight,
       SUM(freight) OVER (PARTITION BY customer_id
                          ORDER BY order_date, order_id) AS running_freight
FROM orders
ORDER BY customer_id, order_date, order_id
LIMIT 20;
```

Correlated subquery, for engines without window functions:

```sql
SELECT o.order_id, o.freight,
       (SELECT SUM(o2.freight) FROM orders o2 WHERE o2.order_id <= o.order_id) AS running_freight
FROM orders o
ORDER BY o.order_id
LIMIT 10;
```

The window form reads the data once. The correlated form re-reads earlier rows for every row, which is O(n²).

## How it works

With `ORDER BY` inside `OVER`, `SUM` adds up the rows in the frame, from the first row of the partition to the current row. Without an explicit frame the default is `RANGE BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW`, which includes every peer row with the same sort value. `ROWS` counts physical rows, so ties do not jump together.

## Execution walkthrough

1. `monthly` reduces order lines to one revenue row per month.
2. The window sorts months in ascending order.
3. For each month, `SUM` covers every month from the first up to this one.
4. The last row's running total equals total revenue.

## Common mistakes

- Leaving out `ORDER BY` in `OVER`. Every row then shows the grand total.
- Relying on the default `RANGE` frame when the sort key has duplicates. Tied rows all get the same, larger total.
- Ordering by a non-unique key without a tie-breaker, so the running order is not deterministic.

## Performance

One sort per distinct window definition. Reuse a named `WINDOW` when several columns share one. Aggregating to months first keeps the window input small.
