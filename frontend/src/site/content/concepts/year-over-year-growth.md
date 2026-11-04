---
slug: year-over-year-growth
title: Year-over-Year Growth in SQL (YoY with LAG)
description: Calculate year-over-year growth in SQL with LAG and conditional aggregation on Northwind revenue, including YoY percent, NULLIF safety and per-category growth.
keywords: year over year growth sql, yoy growth sql, sql percent change previous year, lag year over year, yoy revenue sql, growth rate sql
questions: 117, 103, 111, 101
related: lag-and-lead, date-functions-postgresql, conditional-aggregation-pivot, window-functions
---

Year-over-year (YoY) growth compares a metric for one year with the same metric for the previous year: `(this_year - last_year) / last_year`. In SQL the usual approach is to aggregate by year, then use `LAG` to fetch the prior year's value onto the same row. For two fixed years, conditional aggregation with `FILTER` is a compact alternative.

## Syntax

```sql
WITH yearly AS (
    SELECT EXTRACT(YEAR FROM date_col)::int AS yr,
           SUM(metric) AS total
    FROM some_table
    GROUP BY 1
)
SELECT yr,
       total,
       LAG(total) OVER (ORDER BY yr) AS prev_total,
       100 * (total - LAG(total) OVER (ORDER BY yr))
           / NULLIF(LAG(total) OVER (ORDER BY yr), 0) AS yoy_pct
FROM yearly;
```

## Example

**Business question:** What was total revenue each year, and how much did it grow versus the previous year?

```sql
WITH yearly AS (
    SELECT EXTRACT(YEAR FROM o.order_date)::int AS yr,
           SUM(od.unit_price * od.quantity * (1 - od.discount)) AS revenue
    FROM orders o
    JOIN order_details od ON od.order_id = o.order_id
    GROUP BY 1
)
SELECT yr,
       ROUND(revenue::numeric, 2) AS revenue,
       ROUND(LAG(revenue) OVER (ORDER BY yr)::numeric, 2) AS prev_revenue,
       ROUND((100 * (revenue - LAG(revenue) OVER (ORDER BY yr))
              / NULLIF(LAG(revenue) OVER (ORDER BY yr), 0))::numeric, 1) AS yoy_pct
FROM yearly
ORDER BY yr;
```

Result:

| yr | revenue | prev_revenue | yoy_pct |
|---|---|---|---|
| 1996 | 52325.26 | NULL | NULL |
| 1997 | 40058.78 | 52325.26 | -23.4 |
| 1998 | 45935.76 | 40058.78 | 14.7 |

1996 has no previous year, so its growth is NULL rather than 0 or 100%.

## How it works

1. **Aggregate to the yearly grain.** `EXTRACT(YEAR ...)` or `DATE_TRUNC('year', ...)` produces one row per year.
2. **Bring last year onto this row.** `LAG(revenue) OVER (ORDER BY yr)` reads the previous row's revenue. See [LAG and LEAD](/concepts/lag-and-lead).
3. **Compute the percentage.** Multiply by 100 before dividing, and wrap the denominator in `NULLIF(..., 0)` to avoid division-by-zero errors.
4. **Round last.** Round only the final output so intermediate math stays precise.

**YoY per category with FILTER.** When you compare two known years, pivoting them into columns is often clearer:

```sql
WITH y AS (
    SELECT c.category_name,
           EXTRACT(YEAR FROM o.order_date)::int AS yr,
           SUM(od.unit_price * od.quantity * (1 - od.discount)) AS revenue
    FROM orders o
    JOIN order_details od ON od.order_id    = o.order_id
    JOIN products p       ON p.product_id   = od.product_id
    JOIN categories c     ON c.category_id  = p.category_id
    GROUP BY 1, 2
)
SELECT category_name,
       ROUND(SUM(revenue) FILTER (WHERE yr = 1997)::numeric, 2) AS rev_1997,
       ROUND(SUM(revenue) FILTER (WHERE yr = 1998)::numeric, 2) AS rev_1998,
       ROUND((100 * (SUM(revenue) FILTER (WHERE yr = 1998) - SUM(revenue) FILTER (WHERE yr = 1997))
              / NULLIF(SUM(revenue) FILTER (WHERE yr = 1997), 0))::numeric, 1) AS growth_pct
FROM y
GROUP BY category_name
ORDER BY growth_pct DESC NULLS LAST;
```

| category_name | rev_1997 | rev_1998 | growth_pct |
|---|---|---|---|
| Beverages | 4772.42 | 12857.70 | 169.4 |
| Confections | 5119.97 | 7592.03 | 48.3 |
| Meat/Poultry | 6017.39 | 7711.72 | 28.2 |
| Dairy Products | 6741.73 | 4164.32 | -38.2 |
| Condiments | 5794.68 | 3351.39 | -42.2 |

(Middle rows omitted.) This is the [conditional aggregation](/concepts/conditional-aggregation-pivot) pattern.

## Common mistakes

- **Integer division.** If both values are integers (order counts), `(b - a) / a` truncates to 0. Multiply by `100.0` or cast to numeric first.
- **Dividing by zero.** A year with zero revenue raises an error. Use `NULLIF(prev, 0)`.
- **LAG without partitioning per group.** For per-category YoY with `LAG`, add `PARTITION BY category_name`, or the first year of one category compares against the last year of another.
- **Missing years.** `LAG` takes the previous *row*. If a category had no sales in 1997, its 1998 row compares to 1996. Build a full year list or use the `FILTER` approach with explicit years.
- **Partial years.** Comparing a full year with a partial one exaggerates growth. Check `MIN` and `MAX` dates per year, or compare the same months (year-to-date vs prior YTD).
- **Rounding before dividing.** Rounded inputs give slightly wrong percentages.

## When to use it vs alternatives

| Situation | Approach |
|---|---|
| Many consecutive years | `LAG() OVER (ORDER BY yr)` |
| Per group, many years | `LAG() OVER (PARTITION BY grp ORDER BY yr)` |
| Two specific years side by side | `SUM(...) FILTER (WHERE yr = ...)` |
| Same month last year | `LAG(x, 12)` on a complete monthly series, or self-join on `month - INTERVAL '1 year'` |
| Month-over-month | `LAG` on a monthly CTE, see [Month-over-Month Revenue Change](/questions/q152-month-over-month-revenue-change) |

## Interview questions

### How do you calculate year-over-year growth in SQL?
Aggregate the metric by year in a CTE, use `LAG(metric) OVER (ORDER BY year)` to get the previous year, then compute `100 * (metric - prev) / NULLIF(prev, 0)`. The first year returns NULL.

### Why use NULLIF in the growth formula?
`NULLIF(prev, 0)` turns a zero denominator into NULL, so the division returns NULL instead of raising a division-by-zero error. Growth from zero is undefined anyway.

### How would you compute YoY growth per category?
Add `PARTITION BY category` to the `LAG` window so each category compares only with itself, or pivot the two years into columns with `FILTER` and compute growth across columns.

### What if a year is missing from the data?
`LAG` will compare with the most recent existing year, which is wrong. Generate a complete year series and left join to it, or compare explicit years with conditional aggregation.

## Practice

Practice this pattern with the questions below.
