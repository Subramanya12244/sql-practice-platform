---
slug: lag-and-lead
title: SQL LAG and LEAD Functions Explained with Examples
description: Learn SQL LAG and LEAD with Northwind examples: compare each row to the previous or next one, compute gaps between orders and month-over-month change.
keywords: sql lag function, sql lead function, lag and lead sql, previous row value sql, month over month change sql, days between orders sql
questions: 103, 104, 109, 117, 98
related: window-functions, running-total, year-over-year-growth, date-functions-postgresql
---

`LAG` and `LEAD` are window functions that read a value from another row in the same window: `LAG` looks backward, `LEAD` looks forward. They replace the classic self-join on "previous row" and are the standard tool for period-over-period change, gaps between events, and next-step analysis.

## Syntax

```sql
LAG(expression [, offset [, default]])  OVER (PARTITION BY grp ORDER BY sort_col)
LEAD(expression [, offset [, default]]) OVER (PARTITION BY grp ORDER BY sort_col)
```

- `offset` defaults to 1 (the immediately previous or next row).
- `default` is returned when no such row exists; otherwise the result is NULL.

## Example

**Business question:** For customer BONAP, show each order with the previous order date, days since that order, and the next order date.

```sql
WITH x AS (
    SELECT o.customer_id,
           o.order_id,
           o.order_date,
           LAG(o.order_date)  OVER (PARTITION BY o.customer_id ORDER BY o.order_date, o.order_id) AS prev_order,
           LEAD(o.order_date) OVER (PARTITION BY o.customer_id ORDER BY o.order_date, o.order_id) AS next_order
    FROM orders o
)
SELECT customer_id, order_id, order_date, prev_order,
       order_date - prev_order AS days_since_prev,
       next_order
FROM x
WHERE customer_id = 'BONAP'
ORDER BY order_date, order_id;
```

Illustrative result:

| customer_id | order_id | order_date | prev_order | days_since_prev | next_order |
|---|---|---|---|---|---|
| BONAP | 10347 | 1996-04-16 | NULL | NULL | 1998-09-01 |
| BONAP | 10304 | 1998-09-01 | 1996-04-16 | 868 | 1998-09-09 |
| BONAP | 10256 | 1998-09-09 | 1998-09-01 | 8 | NULL |

The first order has no previous row, so `LAG` returns NULL; the last order has no next row, so `LEAD` returns NULL. Subtracting two `DATE` values in PostgreSQL returns an integer number of days.

## How it works

1. `PARTITION BY customer_id` keeps each customer's history separate, so the first order of one customer never looks at another customer's last order.
2. `ORDER BY order_date, order_id` defines "previous" and "next". The `order_id` tiebreaker makes same-day orders deterministic.
3. The window runs on all orders, and the outer query filters to one customer. Filtering inside the CTE first would give the same result here, but filtering on other columns (such as a date range) before `LAG` can remove the row you wanted to compare against.

**Month-over-month change** combines `LAG` with an aggregated CTE:

```sql
WITH monthly AS (
    SELECT DATE_TRUNC('month', o.order_date)::date AS month,
           SUM(od.unit_price * od.quantity * (1 - od.discount)) AS revenue
    FROM orders o
    JOIN order_details od ON od.order_id = o.order_id
    GROUP BY 1
)
SELECT month,
       ROUND(revenue::numeric, 2) AS revenue,
       ROUND((revenue - LAG(revenue) OVER (ORDER BY month))::numeric, 2) AS change
FROM monthly
ORDER BY month;
```

That is the core of [Month-over-Month Revenue Change](/questions/q152-month-over-month-revenue-change). For yearly comparison see [year-over-year growth](/concepts/year-over-year-growth).

## Common mistakes

- **No `PARTITION BY`.** Gaps are computed across customers, mixing unrelated histories.
- **Missing tiebreaker.** Two orders on the same date may swap order between runs, changing the "previous" row.
- **Filtering before the window.** A `WHERE order_date >= '1998-01-01'` inside the windowed query removes 1997 rows, so the first 1998 row gets NULL instead of its true previous value.
- **Treating NULL as zero.** The first row's difference is NULL, not 0. Use the third argument (`LAG(x, 1, 0)`) or `COALESCE` only if zero is actually correct.
- **Assuming consecutive periods.** `LAG` returns the previous *row*, not the previous calendar month. If months are missing, the comparison spans a gap.
- **Percent change divide-by-zero.** Wrap the denominator with `NULLIF(prev, 0)`.

## When to use it vs alternatives

| Need | Use |
|---|---|
| Value from previous / next row | `LAG` / `LEAD` |
| Value N rows away | `LAG(x, N)` |
| First or last value in the group | `FIRST_VALUE` / `LAST_VALUE` with a full frame |
| Cumulative value up to this row | `SUM() OVER (ORDER BY ...)`, see [running total](/concepts/running-total) |
| Databases without window functions | Self-join on `ROW_NUMBER` or correlated `MAX(date) WHERE date < current` |

The average gap between events is a natural follow-up: compute the gap with `LAG`, then `AVG` it per group, as in [Average Gap Between Employee Orders](/questions/q158-average-gap-between-employee-orders).

## Interview questions

### What is the difference between LAG and LEAD?
`LAG` returns a value from an earlier row in the window order, `LEAD` from a later row. Both take an optional offset and default value, and both require `ORDER BY` inside `OVER` to be meaningful.

### How do you calculate days between consecutive orders per customer?
Use `order_date - LAG(order_date) OVER (PARTITION BY customer_id ORDER BY order_date)`. In PostgreSQL, subtracting dates gives an integer day count. The first order per customer returns NULL.

### How do you compute month-over-month growth in SQL?
Aggregate revenue per month in a CTE, then compute `(revenue - LAG(revenue) OVER (ORDER BY month)) / NULLIF(LAG(revenue) OVER (ORDER BY month), 0)`. Multiply by 100 for a percentage.

### What does LAG return for the first row?
NULL, unless you pass a default as the third argument, such as `LAG(revenue, 1, 0)`. Choose the default carefully, because 0 can distort percentage calculations.

## Practice

Practice this pattern with the questions below.
