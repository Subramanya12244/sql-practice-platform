---
title: Moving averages
slug: moving-averages
category: window-functions
difficulty: Advanced
description: Build rolling averages with AVG() OVER and ROWS or RANGE frames, handle partial windows and date gaps in PostgreSQL.
prerequisites: [avg, window-order-by, running-totals]
related: [running-totals, window-order-by, date-time-functions]
questions: [151, 150]
patterns: [moving-average]
guides: [window-functions]
minutes: 9
version: 1
---

## Introduction

A moving (rolling) average smooths noisy series: 3-month average revenue, 7-day average orders. It is an aggregate over a sliding frame.

## Definition

`AVG(x) OVER (ORDER BY k ROWS BETWEEN n-1 PRECEDING AND CURRENT ROW)` is an n-row trailing moving average. Using `RANGE BETWEEN INTERVAL '...' PRECEDING AND CURRENT ROW` makes it time-based.

## Why it matters

- Question 102 (3-month moving average).
- Tests `ROWS` vs `RANGE` and edge handling.

## How it works

- `ROWS n PRECEDING`: last n+1 **rows**, regardless of date gaps.
- `RANGE INTERVAL 'd' PRECEDING`: rows whose key is within the interval, so missing days shrink the window naturally.
- The first rows have partial windows; average uses fewer values. Hide them with `COUNT(*) OVER same_frame` if needed.

## Syntax

```sql-syntax
AVG(x) OVER ([PARTITION BY g] ORDER BY k ROWS BETWEEN n PRECEDING AND CURRENT ROW)
AVG(x) OVER ([PARTITION BY g] ORDER BY date_col
             RANGE BETWEEN INTERVAL '6 days' PRECEDING AND CURRENT ROW)
```

## Simple examples

3-order moving average of freight:

```sql
SELECT order_id, freight,
       ROUND(AVG(freight) OVER (ORDER BY order_id ROWS BETWEEN 2 PRECEDING AND CURRENT ROW), 2) AS ma3
FROM orders
ORDER BY order_id
LIMIT 6;
```

## Intermediate examples

3-month moving average revenue with a named window (question 102), hiding partial windows:

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
       CASE WHEN COUNT(*) OVER w = 3 THEN ROUND(AVG(revenue) OVER w, 2) END AS ma_3m
FROM m
WINDOW w AS (ORDER BY month ROWS BETWEEN 2 PRECEDING AND CURRENT ROW)
ORDER BY month;
```

## Advanced examples

Time-based window: average freight over the last 30 days, robust to gaps.

```sql
SELECT order_id, order_date, freight,
       ROUND(AVG(freight) OVER (ORDER BY order_date
             RANGE BETWEEN INTERVAL '29 days' PRECEDING AND CURRENT ROW), 2) AS avg_30d
FROM orders
ORDER BY order_date, order_id
LIMIT 10;
```

Centered moving average (1 before, 1 after):

```sql
WITH m AS (
  SELECT DATE_TRUNC('month', order_date)::date AS month, COUNT(*) AS orders
  FROM orders
  GROUP BY 1
)
SELECT month, orders,
       ROUND(AVG(orders) OVER (ORDER BY month ROWS BETWEEN 1 PRECEDING AND 1 FOLLOWING), 2) AS centered_ma
FROM m
ORDER BY month;
```

## Real-world scenarios

- 7-day average active users.
- Rolling 3-month revenue for forecasting.
- Smoothing sensor or price series.

## PostgreSQL specifics

- `RANGE` with an interval offset works on `date` and `timestamp` keys (PostgreSQL 11+) and needs a single `ORDER BY` column.
- `AVG` of `integer`/`bigint` returns `numeric`; of `real`/`double precision` returns `double precision`.
- Sliding aggregates are computed incrementally for many built-in aggregates (moving-aggregate support).

## Visual explanation

```text
month  rev  ROWS 2 PRECEDING frame   ma3
Jan    100  [Jan]                     100   (partial)
Feb    120  [Jan Feb]                 110   (partial)
Mar     90  [Jan Feb Mar]             103.3
Apr    150  [Feb Mar Apr]             120
```

## Common mistakes

- `ROWS 3 PRECEDING` for a 3-period average (that is 4 rows). n-period = `n-1 PRECEDING`.
- Using `ROWS` when dates have gaps and a calendar window is intended. Use `RANGE INTERVAL` or fill gaps with `generate_series`.
- Not handling partial windows at the start.
- `ROUND` on `double precision` with two arguments fails; cast to `numeric`.

## Performance

One sort plus a sliding pass. Index on the order key (and partition key) avoids the sort on large tables.

## Interview questions

### Write a 3-month moving average.

Aggregate per month, then `AVG(revenue) OVER (ORDER BY month ROWS BETWEEN 2 PRECEDING AND CURRENT ROW)`.

### ROWS or RANGE for a 7-day average?

`RANGE BETWEEN INTERVAL '6 days' PRECEDING AND CURRENT ROW` if days can be missing; `ROWS 6 PRECEDING` only if there is exactly one row per day.

### How do you skip incomplete windows?

Compute `COUNT(*)` over the same frame and return the average only when it equals the window size.

## Quick revision

- `AVG(x) OVER (ORDER BY k ROWS BETWEEN n-1 PRECEDING AND CURRENT ROW)`.
- `RANGE INTERVAL` for calendar windows.
- First rows are partial.
- Named `WINDOW` keeps `AVG` and `COUNT` frames identical.
- Centered: `1 PRECEDING AND 1 FOLLOWING`.
