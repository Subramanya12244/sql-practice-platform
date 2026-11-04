---
title: Moving average
slug: moving-average
category: running
difficulty: Intermediate
description: Smooth a series with AVG() OVER (ROWS BETWEEN N PRECEDING AND CURRENT ROW), handle short windows, and use RANGE with intervals for calendar windows.
questions: [102, 101, 109]
notes: [moving-averages, window-order-by, avg, running-totals]
guides: [window-functions]
---

## Problem

Compute the average of the current row and the previous N-1 rows, for example a 3-month moving average of revenue.

## When to use it

- Smoothing noisy daily or monthly metrics.
- Trend lines in dashboards.
- Rolling 7-day or 30-day activity.

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
       ROUND(AVG(revenue) OVER w::numeric, 2) AS moving_avg_3m,
       COUNT(*) OVER w AS months_in_window
FROM monthly
WINDOW w AS (ORDER BY month ROWS BETWEEN 2 PRECEDING AND CURRENT ROW)
ORDER BY month;
```

## Alternatives

Calendar-based window with `RANGE` and an interval, so missing months do not stretch the window (PostgreSQL 11+):

```sql
WITH monthly AS (
  SELECT date_trunc('month', order_date)::date AS month, SUM(freight) AS freight
  FROM orders
  GROUP BY 1
)
SELECT month, freight,
       ROUND(AVG(freight) OVER (ORDER BY month
             RANGE BETWEEN interval '2 months' PRECEDING AND CURRENT ROW), 2) AS freight_avg_3m
FROM monthly
ORDER BY month;
```

Show NULL until the window is full:

```sql
WITH monthly AS (
  SELECT date_trunc('month', order_date)::date AS month, SUM(freight) AS freight
  FROM orders
  GROUP BY 1
)
SELECT month, freight,
       CASE WHEN COUNT(*) OVER w = 3 THEN ROUND(AVG(freight) OVER w, 2) END AS freight_avg_3m
FROM monthly
WINDOW w AS (ORDER BY month ROWS BETWEEN 2 PRECEDING AND CURRENT ROW)
ORDER BY month;
```

`ROWS` counts rows, so a missing month makes the window cover more than 3 calendar months. `RANGE` with an interval counts calendar time.

## How it works

The frame `ROWS BETWEEN 2 PRECEDING AND CURRENT ROW` holds at most 3 rows: two before plus the current one. `AVG` averages whatever rows the frame holds, so the first two rows average fewer values. `COUNT(*) OVER w` shows how many rows each average used.

## Execution walkthrough

1. `monthly` produces one row per month.
2. The window sorts months in ascending order.
3. Row 1 averages 1 month, row 2 averages 2, and row 3 onward averages 3.
4. The named window `w` is reused by `AVG` and `COUNT`, so PostgreSQL sorts once.

## Common mistakes

- `ROWS BETWEEN 3 PRECEDING …` for a 3-period average. That covers 4 rows.
- Computing the average on raw order rows instead of monthly totals.
- Ignoring gaps in the series. Fill them with `generate_series` or use `RANGE` with an interval.

## Performance

The frame moves one row at a time, so the cost is one sort plus a linear scan. Aggregate first to keep the sorted input small.
