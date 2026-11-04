---
title: Year-over-year growth
slug: year-over-year-growth
category: growth
difficulty: Intermediate
description: Compare a period with the same period a year earlier using LAG over yearly totals, LAG(…, 12) over months, or conditional aggregation.
questions: [117, 111, 131]
notes: [lag, date-time-functions, conditional-aggregation, filter-clause]
guides: [year-over-year-growth]
---

## Problem

Compare revenue for each year, or each month, with the same period one year earlier.

## When to use it

- Annual reports and seasonal businesses, where month-over-month is misleading.
- Interview questions such as "growth by category compared with last year".

## Solution

Yearly totals with `LAG`:

```sql
WITH yearly AS (
  SELECT EXTRACT(YEAR FROM o.order_date)::int AS year,
         SUM(od.unit_price * od.quantity * (1 - od.discount))::numeric AS revenue
  FROM orders o
  JOIN order_details od ON od.order_id = o.order_id
  GROUP BY 1
)
SELECT year,
       ROUND(revenue, 2) AS revenue,
       ROUND(LAG(revenue) OVER (ORDER BY year), 2) AS prev_year,
       ROUND(100 * (revenue / NULLIF(LAG(revenue) OVER (ORDER BY year), 0) - 1), 1) AS yoy_pct
FROM yearly
ORDER BY year;
```

## Alternatives

Same month last year (NULL when that month had no orders), by left-joining monthly totals on `month - 1 year`:

```sql
WITH monthly AS (
  SELECT date_trunc('month', order_date)::date AS month, SUM(freight) AS freight
  FROM orders
  GROUP BY 1
)
SELECT cur.month, cur.freight, prev.freight AS freight_last_year
FROM monthly cur
LEFT JOIN monthly prev ON prev.month = cur.month - interval '1 year'
ORDER BY cur.month;
```

Years side by side per category with `FILTER` (PostgreSQL), relative to the latest year in the data:

```sql
WITH lines AS (
  SELECT p.category_id,
         EXTRACT(YEAR FROM o.order_date)::int AS year,
         od.unit_price * od.quantity * (1 - od.discount) AS revenue
  FROM order_details od
  JOIN orders o   ON o.order_id = od.order_id
  JOIN products p ON p.product_id = od.product_id
),
last_year AS (SELECT MAX(year) AS y FROM lines)
SELECT l.category_id,
       ROUND(SUM(revenue) FILTER (WHERE year = y)::numeric, 2)     AS this_year,
       ROUND(SUM(revenue) FILTER (WHERE year = y - 1)::numeric, 2) AS previous_year
FROM lines l CROSS JOIN last_year
GROUP BY l.category_id
ORDER BY l.category_id;
```

`LAG` over years is simplest when every year exists. The self-join matches exact calendar periods, so a missing month cannot shift the comparison. The `FILTER` form produces a report with one column per year.

## How it works

Aggregate to one row per period first. Then fetch the comparison period: the previous row with `LAG` (yearly data), or the row exactly one year earlier with a join. Growth is `current / previous - 1`, and `NULLIF` guards against zero.

## Execution walkthrough

1. `yearly` sums revenue per calendar year.
2. `LAG` returns the previous year's revenue. The first year gets NULL.
3. `revenue / previous - 1` gives the growth rate, multiplied by 100 for a percentage.
4. A partial final year shows a misleading drop. Compare equal periods (year to date) in real reports.

## Common mistakes

- Comparing a partial year with a full year.
- `LAG(revenue, 12)` over months when some months are missing. It then compares the wrong months.
- Hard-coding years. Derive them from `MAX(order_date)` or parameters.

## Performance

Aggregating first makes the window input tiny. For large fact tables, filter to the two years you need with a range on `order_date` so an index can be used.
