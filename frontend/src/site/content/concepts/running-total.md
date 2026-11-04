---
slug: running-total
title: SQL Running Total with SUM() OVER
description: Learn how to calculate a SQL running total with SUM() OVER (ORDER BY), reset it per year with PARTITION BY, and avoid ROWS vs RANGE tie traps in PostgreSQL.
keywords: sql running total, cumulative sum sql, sum over order by, running total postgresql, year to date sql, cumulative total by month
questions: 101, 102, 103, 105
related: window-functions, lag-and-lead, date-functions-postgresql, year-over-year-growth
---

A running total (cumulative sum) adds each row's value to the sum of all rows before it in a given order. In SQL it is written as `SUM(value) OVER (ORDER BY sort_col)`. Add `PARTITION BY` to restart the total for each group, such as year-to-date revenue.

## Syntax

```sql
SELECT sort_col,
       value,
       SUM(value) OVER (
           PARTITION BY group_col           -- optional reset
           ORDER BY sort_col
           ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW
       ) AS running_total
FROM some_table;
```

## Example

**Business question:** Show monthly revenue, the all-time running total, and a year-to-date total that resets every January.

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
       ROUND(SUM(revenue) OVER (ORDER BY month)::numeric, 2) AS running_total,
       ROUND(SUM(revenue) OVER (PARTITION BY EXTRACT(YEAR FROM month)
                                ORDER BY month)::numeric, 2) AS ytd
FROM monthly
ORDER BY month;
```

Illustrative result (first rows):

| month | revenue | running_total | ytd |
|---|---|---|---|
| 1996-01-01 | 5217.41 | 5217.41 | 5217.41 |
| 1996-04-01 | 18574.06 | 23791.47 | 23791.47 |
| 1996-07-01 | 19336.35 | 43127.82 | 43127.82 |
| 1996-10-01 | 9197.44 | 52325.26 | 52325.26 |
| 1997-02-01 | 7450.80 | 59776.06 | 7450.80 |
| 1997-05-01 | 3460.08 | 63236.14 | 10910.88 |

The `ytd` column restarts at 1997-02, while `running_total` keeps growing. Months with no orders do not appear; the dataset is sparse.

## How it works

1. The CTE aggregates to one row per month first. Running a window over raw order lines would give a line-level cumulative sum.
2. `ORDER BY month` inside `OVER` tells SQL which rows count as "before".
3. With `ORDER BY` and no frame, the default frame is `RANGE BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW`: every row from the start of the partition up to the current one, plus its peers.
4. `PARTITION BY EXTRACT(YEAR FROM month)` makes each year an independent window.

Swap `SUM` for `AVG` and narrow the frame to get a moving average, as in [Three-Month Moving Average Revenue](/questions/q151-three-month-moving-average-revenue):

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
       -- frame: current month and the two rows before it
       ROUND(AVG(revenue) OVER (ORDER BY month
                                ROWS BETWEEN 2 PRECEDING AND CURRENT ROW)::numeric, 2) AS moving_avg_3
FROM monthly
ORDER BY month;
```

The first row averages one month, the second row two, and from the third row on it averages three rows. Because the dataset skips months, "three rows" here is not always three calendar months; a `generate_series` calendar fixes that when it matters.

## Common mistakes

- **Forgetting `ORDER BY` in `OVER`.** `SUM(revenue) OVER ()` puts the grand total on every row, not a running total.
- **Ties under the default `RANGE` frame.** If two rows share the same `ORDER BY` value, both get the combined total at once. Use `ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW` or add a unique tiebreaker.
- **Not aggregating first.** Running totals over `order_details` give one row per line item. Group by the period in a CTE.
- **Outer `ORDER BY` differs from window order.** The window still computes correctly, but the output looks jumbled. Sort the final result the same way.
- **Gaps in periods.** Missing months simply do not appear. Generate a calendar with `generate_series` and left join if every month must show.
- **Using a correlated subquery.** `(SELECT SUM(...) WHERE month <= m.month)` works but re-scans per row. The window version is a single pass.

## When to use it vs alternatives

- **Cumulative totals, YTD, running counts:** `SUM()` / `COUNT()` `OVER (ORDER BY ...)`.
- **Change from previous period:** `LAG()`; see [LAG and LEAD](/concepts/lag-and-lead).
- **Share of total:** `value / SUM(value) OVER ()`, as in [Customer Share of Total Revenue](/questions/q154-customer-share-of-total-revenue).
- **Older databases without window functions:** correlated subquery or self-join with `<=`, accepting the cost.

## Interview questions

### How do you calculate a running total in SQL?
Use `SUM(value) OVER (ORDER BY sort_col)`. Each row gets the sum of all rows up to and including itself in that order. Aggregate to the right grain first if the source has multiple rows per period.

### How do you reset a running total each year?
Add `PARTITION BY` with the year, for example `SUM(revenue) OVER (PARTITION BY EXTRACT(YEAR FROM month) ORDER BY month)`. The sum restarts at the first row of each partition.

### What is the difference between ROWS and RANGE in a running total?
`ROWS` counts physical rows, so tied values are added one at a time. `RANGE` treats rows with equal sort values as peers and includes all of them together. They only differ when the `ORDER BY` column has duplicates.

### How would you compute a 3-month moving average?
Use `AVG(revenue) OVER (ORDER BY month ROWS BETWEEN 2 PRECEDING AND CURRENT ROW)`. The first two rows average fewer than three months, which you may want to blank out with a `CASE` on `ROW_NUMBER()`.

## Practice

Practice this pattern with the questions below.
