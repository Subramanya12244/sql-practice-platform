---
title: Running totals
slug: running-totals
category: window-functions
difficulty: Intermediate
description: Compute cumulative sums with SUM() OVER (ORDER BY ...), choose ROWS vs RANGE correctly, and reset totals per group in PostgreSQL.
prerequisites: [sum, window-order-by, partition-by]
related: [moving-averages, window-order-by, over, lag]
questions: [150, 168, 154]
patterns: [running-total, month-over-month-growth]
guides: [running-total]
minutes: 8
version: 1
---

## Introduction

A running total adds each row's value to everything before it: cumulative revenue, account balance, cumulative signups.

## Definition

A running total is `SUM(x) OVER (ORDER BY k ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW)`, optionally with `PARTITION BY` to restart per group.

## Why it matters

- Very common in analytics interviews (question 101).
- Tests understanding of default frames and ties.

## How it works

1. Order rows by time.
2. Frame = partition start to current row.
3. Sum the frame.

The default frame is `RANGE ... CURRENT ROW`, which includes **peers**. With ties in the order key, tied rows show the same total. `ROWS` gives a strictly row-by-row total.

## Syntax

```sql-syntax
SUM(x) OVER ([PARTITION BY g] ORDER BY k
             ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW)
-- shorthand
SUM(x) OVER ([PARTITION BY g] ORDER BY k ROWS UNBOUNDED PRECEDING)
```

## Simple examples

Running freight by order:

```sql
SELECT order_id, freight,
       SUM(freight) OVER (ORDER BY order_id ROWS UNBOUNDED PRECEDING) AS running_freight
FROM orders
ORDER BY order_id
LIMIT 5;
```

## Intermediate examples

Running total of monthly revenue (question 101):

```sql
WITH m AS (
  SELECT DATE_TRUNC('month', o.order_date)::date AS month,
         SUM(od.unit_price * od.quantity * (1 - od.discount))::numeric AS revenue
  FROM orders o
  JOIN order_details od ON od.order_id = o.order_id
  GROUP BY 1
)
SELECT month,
       ROUND(revenue, 2) AS revenue,
       ROUND(SUM(revenue) OVER (ORDER BY month ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW), 2) AS running_revenue
FROM m
ORDER BY month;
```

## Advanced examples

Reset per year and show running share of the yearly total:

```sql
WITH m AS (
  SELECT DATE_TRUNC('month', o.order_date)::date AS month,
         SUM(od.unit_price * od.quantity * (1 - od.discount))::numeric AS revenue
  FROM orders o
  JOIN order_details od ON od.order_id = o.order_id
  GROUP BY 1
)
SELECT month,
       ROUND(SUM(revenue) OVER (PARTITION BY EXTRACT(YEAR FROM month) ORDER BY month
                                ROWS UNBOUNDED PRECEDING), 2) AS ytd_revenue,
       ROUND(100 * SUM(revenue) OVER (PARTITION BY EXTRACT(YEAR FROM month) ORDER BY month
                                      ROWS UNBOUNDED PRECEDING)
             / SUM(revenue) OVER (PARTITION BY EXTRACT(YEAR FROM month)), 1) AS pct_of_year
FROM m
ORDER BY month;
```

Ties: `RANGE` vs `ROWS` on `order_date`.

```sql
SELECT order_id, order_date, freight,
       SUM(freight) OVER (ORDER BY order_date) AS range_total,
       SUM(freight) OVER (ORDER BY order_date, order_id ROWS UNBOUNDED PRECEDING) AS rows_total
FROM orders
ORDER BY order_date, order_id
LIMIT 10;
```

Cumulative cohort size by first-order month (question 119):

```sql
WITH firsts AS (
  SELECT customer_id, DATE_TRUNC('month', MIN(order_date))::date AS cohort
  FROM orders
  GROUP BY customer_id
)
SELECT cohort, COUNT(*) AS new_customers,
       SUM(COUNT(*)) OVER (ORDER BY cohort) AS cumulative_customers
FROM firsts
GROUP BY cohort
ORDER BY cohort;
```

## Real-world scenarios

- Year-to-date revenue.
- Account balances from a transaction ledger.
- Cumulative signups or inventory movements.

## PostgreSQL specifics

- `SUM` of `integer` returns `bigint`, of `numeric` returns `numeric`, of `real` returns `real`. Cast money-like values to `numeric` before rounding.
- `ROUND(x, n)` needs `numeric`, not `double precision`.

## Visual explanation

```text
month  rev   running
Jan    100   100
Feb    120   220
Mar     90   310
```

## Common mistakes

- Default `RANGE` frame with tied keys: same total on tied rows.
- Missing `PARTITION BY` when totals should reset per customer or year.
- Correlated subquery `SELECT SUM(...) WHERE d <= outer.d`: correct but O(n^2).
- Missing months: totals look flat but months are absent. Use `generate_series` to fill.

## Performance

A running sum is computed incrementally in one pass after sorting. Much faster than a self-join or correlated subquery.

## Interview questions

### Write a running total of monthly revenue.

Aggregate by month in a CTE, then `SUM(revenue) OVER (ORDER BY month ROWS UNBOUNDED PRECEDING)`.

### Why do some rows show the same running total?

The default `RANGE` frame includes peers. Use `ROWS` or a unique order key.

### How do you reset the total every year?

Add `PARTITION BY EXTRACT(YEAR FROM month)` (or `DATE_TRUNC('year', ...)`).

## Quick revision

- `SUM(x) OVER (ORDER BY k ROWS UNBOUNDED PRECEDING)`.
- `PARTITION BY` to reset.
- Prefer `ROWS`; default `RANGE` merges ties.
- `SUM(SUM(x)) OVER (...)` for running totals of grouped data.
- Fill date gaps if needed.
