---
title: Month-over-month growth
slug: month-over-month-growth
category: growth
difficulty: Intermediate
description: Compare each month with the previous one using LAG, compute percent change safely with NULLIF, and handle months with no data.
questions: [103, 101, 117]
notes: [lag, date-time-functions, null-handling, window-order-by]
guides: [lag-and-lead]
---

## Problem

For each month, show revenue, the previous month's revenue, the absolute change and the percent change.

## When to use it

- KPI dashboards and monthly business reviews.
- "Which month had the biggest drop?" interview questions.

## Solution

```sql
WITH monthly AS (
  SELECT date_trunc('month', o.order_date)::date AS month,
         SUM(od.unit_price * od.quantity * (1 - od.discount))::numeric AS revenue
  FROM orders o
  JOIN order_details od ON od.order_id = o.order_id
  GROUP BY 1
)
SELECT month,
       ROUND(revenue, 2) AS revenue,
       ROUND(LAG(revenue) OVER (ORDER BY month), 2) AS prev_revenue,
       ROUND(revenue - LAG(revenue) OVER (ORDER BY month), 2) AS change,
       ROUND(100 * (revenue - LAG(revenue) OVER (ORDER BY month))
             / NULLIF(LAG(revenue) OVER (ORDER BY month), 0), 1) AS pct_change
FROM monthly
ORDER BY month;
```

## Alternatives

Fill empty months first so `LAG` compares true calendar neighbours:

```sql
WITH months AS (
  SELECT generate_series(date_trunc('month', MIN(order_date)),
                         date_trunc('month', MAX(order_date)),
                         interval '1 month')::date AS month
  FROM orders
),
monthly AS (
  SELECT m.month, COALESCE(SUM(o.freight), 0) AS freight
  FROM months m
  LEFT JOIN orders o ON date_trunc('month', o.order_date) = m.month
  GROUP BY m.month
)
SELECT month, freight,
       freight - LAG(freight) OVER (ORDER BY month) AS change
FROM monthly
ORDER BY month;
```

Self-join on the previous month (portable, no window functions):

```sql
WITH monthly AS (
  SELECT date_trunc('month', order_date)::date AS month, SUM(freight) AS freight
  FROM orders
  GROUP BY 1
)
SELECT cur.month, cur.freight, prev.freight AS prev_freight
FROM monthly cur
LEFT JOIN monthly prev ON prev.month = cur.month - interval '1 month'
ORDER BY cur.month;
```

`LAG` takes the previous *row*, so a missing month makes it compare with an older month. The calendar fill or the self-join compares with the true previous month.

## How it works

`LAG(revenue) OVER (ORDER BY month)` returns the previous row's revenue, or NULL for the first row. Percent change is `(current - previous) / previous`. `NULLIF(previous, 0)` turns a zero into NULL, so the division returns NULL instead of an error.

## Execution walkthrough

1. `monthly` totals revenue per month.
2. The window sorts months, and `LAG` reads the previous month's revenue.
3. The first month has no previous row, so its change columns are NULL.
4. The percent is multiplied by 100 before division to keep numeric precision.

## Common mistakes

- Integer division. Cast to `numeric` before dividing.
- Dividing by zero. Wrap the denominator in `NULLIF(…, 0)`.
- Using `LAG` on raw order rows instead of monthly totals.
- Grouping by `EXTRACT(MONTH …)` only, which merges the same month from different years.

## Performance

All `LAG` calls share one window definition, so PostgreSQL sorts once. Name it with `WINDOW w AS (ORDER BY month)` for readability.
