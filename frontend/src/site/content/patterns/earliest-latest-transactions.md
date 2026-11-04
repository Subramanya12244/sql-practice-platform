---
title: Earliest and latest transactions
slug: earliest-latest-transactions
category: latest
difficulty: Intermediate
description: Show each customer's first and last order side by side with MIN/MAX, FIRST_VALUE/LAST_VALUE, or conditional aggregation on ROW_NUMBER.
questions: [107, 26, 119]
notes: [min-max, first-value, last-value, row-number]
guides: [window-functions]
---

## Problem

For each customer, return the first and the most recent transaction, both dates and details such as the order id or freight.

## When to use it

- Customer lifetime (first order to last order).
- Cohort analysis based on the first purchase.
- Comparing the opening and closing values of a period.

## Solution

Dates only need `MIN` and `MAX`:

```sql
SELECT customer_id,
       MIN(order_date) AS first_order,
       MAX(order_date) AS last_order,
       MAX(order_date) - MIN(order_date) AS days_active,
       COUNT(*) AS orders
FROM orders
GROUP BY customer_id
ORDER BY days_active DESC;
```

## Alternatives

Details of the first and last order with `FIRST_VALUE` and `LAST_VALUE`. `LAST_VALUE` needs a full frame:

```sql
SELECT DISTINCT customer_id,
       FIRST_VALUE(order_id) OVER w AS first_order_id,
       LAST_VALUE(order_id)  OVER w AS last_order_id,
       FIRST_VALUE(freight)  OVER w AS first_freight,
       LAST_VALUE(freight)   OVER w AS last_freight
FROM orders
WINDOW w AS (PARTITION BY customer_id
             ORDER BY order_date, order_id
             ROWS BETWEEN UNBOUNDED PRECEDING AND UNBOUNDED FOLLOWING)
ORDER BY customer_id;
```

Rank both ways and pivot with `FILTER` (PostgreSQL syntax for conditional aggregation):

```sql
WITH r AS (
  SELECT customer_id, order_id, order_date,
         ROW_NUMBER() OVER (PARTITION BY customer_id ORDER BY order_date, order_id) AS first_rn,
         ROW_NUMBER() OVER (PARTITION BY customer_id ORDER BY order_date DESC, order_id DESC) AS last_rn
  FROM orders
)
SELECT customer_id,
       MAX(order_id) FILTER (WHERE first_rn = 1) AS first_order_id,
       MAX(order_id) FILTER (WHERE last_rn = 1)  AS last_order_id
FROM r
GROUP BY customer_id
ORDER BY customer_id;
```

`MIN`/`MAX` is the cheapest but gives only the values themselves. The window forms return any column of the first and last row.

## How it works

`MIN` and `MAX` work per group. `FIRST_VALUE` and `LAST_VALUE` read the first and last row of the window frame. The default frame ends at the current row, so `LAST_VALUE` would return the current row. `ROWS BETWEEN UNBOUNDED PRECEDING AND UNBOUNDED FOLLOWING` makes the frame the whole partition.

## Execution walkthrough

1. Orders are grouped (or partitioned) by `customer_id`.
2. `MIN(order_date)` and `MAX(order_date)` scan each group once.
3. Date minus date returns an integer number of days in PostgreSQL.
4. `ORDER BY days_active DESC` lists the longest-active customers first.

## Common mistakes

- `LAST_VALUE` with the default frame. It returns the current row's value.
- `MIN(order_id)` as "the first order". Ids do not have to follow dates.
- Mixing `MIN(order_date)` with a non-aggregated column such as `freight`. Use a window instead.

## Performance

One `GROUP BY` pass is cheapest. Two windows with different sort orders need two sorts. An index on `(customer_id, order_date)` helps all forms.
