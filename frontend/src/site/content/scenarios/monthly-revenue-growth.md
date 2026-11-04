---
title: Monthly revenue growth
slug: monthly-revenue-growth
dataset: northwind
difficulty: Medium
description: Build a month-by-month revenue report with the previous month's revenue and month-over-month growth percentage.
orderBy: month
notes: [lag, window-order-by, date-time-functions, self-join]
patterns: [month-over-month-growth]
---

## Business context
Finance is preparing a board deck and wants to see how revenue moved month to month across the whole order history. They want one row per month with the growth rate already calculated so they can paste it into a chart.

## Problem
For every calendar month from the first order month to the last order month, show total revenue, the previous calendar month's revenue and the growth percentage versus that previous month. Months without any orders must still appear, with revenue 0.

## Available data
- `orders`: `order_id`, `order_date`
- `order_details`: `order_id`, `unit_price`, `quantity`, `discount`

## Expected outcome
The growth column feeds a board chart; months with no sales are visible as gaps instead of silently disappearing.

## Success criteria
- Output columns, exactly: `month`, `revenue`, `prev_month_revenue`, `growth_pct`
- `month` is text in `YYYY-MM` form, e.g. `1996-01`; one row per calendar month between the first and last order month (inclusive).
- Line revenue = `unit_price * quantity * (1 - discount)`, `discount` cast to numeric. A month with no orders has revenue `0`.
- `growth_pct` = 100 * (revenue - previous) / previous; NULL for the first month and whenever the previous month's revenue is 0.
- The first month has NULL `prev_month_revenue`.
- Round `revenue`, `prev_month_revenue`, `growth_pct` to 2 decimals with `ROUND(x::numeric, 2)` (round only at the end).
- Sort by `month`.

```solution
WITH bounds AS (
  SELECT date_trunc('month', MIN(order_date)) AS first_m, date_trunc('month', MAX(order_date)) AS last_m
  FROM orders
),
months AS (
  SELECT generate_series(first_m, last_m, INTERVAL '1 month')::date AS month_start FROM bounds
),
rev AS (
  SELECT date_trunc('month', o.order_date)::date AS month_start,
         SUM(od.unit_price * od.quantity * (1 - od.discount::numeric)) AS rev
  FROM orders o JOIN order_details od ON od.order_id = o.order_id
  GROUP BY 1
),
m AS (
  SELECT ms.month_start, COALESCE(r.rev, 0) AS rev,
         LAG(COALESCE(r.rev, 0)) OVER (ORDER BY ms.month_start) AS prev
  FROM months ms LEFT JOIN rev r ON r.month_start = ms.month_start
)
SELECT to_char(month_start, 'YYYY-MM') AS month,
       ROUND(rev::numeric, 2) AS revenue,
       ROUND(prev::numeric, 2) AS prev_month_revenue,
       ROUND((100 * (rev - prev) / NULLIF(prev, 0))::numeric, 2) AS growth_pct
FROM m
ORDER BY month;
```

```alternative
WITH months AS (
  SELECT generate_series(
           (SELECT date_trunc('month', MIN(order_date)) FROM orders),
           (SELECT date_trunc('month', MAX(order_date)) FROM orders),
           INTERVAL '1 month')::date AS month_start
),
m AS (
  SELECT ms.month_start,
         (SELECT COALESCE(SUM(od.unit_price * od.quantity * (1 - od.discount::numeric)), 0)
          FROM orders o JOIN order_details od ON od.order_id = o.order_id
          WHERE o.order_date >= ms.month_start
            AND o.order_date < ms.month_start + INTERVAL '1 month') AS rev
  FROM months ms
)
SELECT to_char(cur.month_start, 'YYYY-MM') AS month,
       ROUND(cur.rev::numeric, 2) AS revenue,
       ROUND(prev.rev::numeric, 2) AS prev_month_revenue,
       ROUND((100 * (cur.rev - prev.rev) / NULLIF(prev.rev, 0))::numeric, 2) AS growth_pct
FROM m cur
LEFT JOIN m prev ON prev.month_start = (cur.month_start - INTERVAL '1 month')::date
ORDER BY month;
```

## Explanation
Northwind orders are sparse: many calendar months have no orders at all. Grouping orders by month alone would make `LAG` compare a month with whatever month happened to have sales before it, which is not month-over-month. Generating a calendar with `generate_series` and LEFT JOINing revenue onto it fixes that. `NULLIF(prev, 0)` avoids dividing by zero after an empty month. The alternative computes each month's revenue with a correlated subquery and finds the previous month with a self-join on `month_start - 1 month`.

## Follow-up questions
### How would you compute year-over-year growth?
Use `LAG(rev, 12)` or join on `month_start - INTERVAL '1 year'`.
### Why round only at the end?
Rounding intermediate sums introduces drift in the growth percentage.
