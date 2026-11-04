---
title: Date and time functions
slug: date-time-functions
category: advanced-sql
difficulty: Intermediate
description: Extract parts, truncate to periods, add intervals and subtract dates in PostgreSQL with EXTRACT, DATE_TRUNC, AGE and TO_CHAR.
prerequisites: [select, where, group-by]
related: [string-functions, running-totals, lag, window-order-by]
questions: [159, 160, 161, 162, 164, 168]
patterns: [month-over-month-growth, year-over-year-growth, consecutive-dates, gaps-and-islands, inactive-customers]
guides: [date-functions-postgresql, year-over-year-growth]
minutes: 9
version: 1
---

## Introduction

Most reporting questions are about time: revenue per month, days to ship, customers inactive for six months. You need a small toolkit: extract a part, truncate to a period, do arithmetic, format for display.

## Definition

Date/time functions operate on the types `date`, `timestamp`, `timestamptz`, `time` and `interval`. In PostgreSQL the core ones are `EXTRACT`, `DATE_TRUNC`, `AGE`, `TO_CHAR`, `CURRENT_DATE`, `NOW()` and the `+`/`-` operators with `interval`.

## Why it matters

- Grouping by month or quarter is the backbone of trend reports.
- Date arithmetic answers "how late", "how long", "how old".
- Interviewers check whether you know that `date - date` gives an integer in PostgreSQL, and that `DATE_TRUNC` keeps a sortable date while `TO_CHAR` gives text.

## How it works

- `EXTRACT(field FROM value)` returns a number (`numeric` in PostgreSQL 14+): `YEAR`, `MONTH`, `QUARTER`, `DOW` (0 = Sunday), `ISODOW` (1 = Monday), `EPOCH`.
- `DATE_TRUNC('month', value)` rounds down to the start of the period and returns a `timestamp`.
- `date - date` returns an `integer` number of days. `timestamp - timestamp` returns an `interval`.
- `date + integer` adds days. `date + interval '1 month'` returns a `timestamp`.
- `AGE(a, b)` returns a symbolic interval like `3 years 2 mons`.

## Syntax

```sql-syntax
EXTRACT(YEAR FROM date_col)
DATE_TRUNC('month', date_col)          -- 'day' | 'week' | 'month' | 'quarter' | 'year'
date_col + INTERVAL '30 days'
end_date - start_date                  -- integer days for DATE
AGE(later_ts, earlier_ts)
TO_CHAR(date_col, 'YYYY-MM Dy')
```

## Simple examples

Orders per year and month:

```sql
SELECT EXTRACT(YEAR FROM order_date)::int  AS yr,
       EXTRACT(MONTH FROM order_date)::int AS mon,
       COUNT(*) AS orders
FROM orders
GROUP BY 1, 2
ORDER BY 1, 2;
```

Days taken to ship each order:

```sql
SELECT order_id, order_date, shipped_date,
       shipped_date - order_date AS days_to_ship
FROM orders
WHERE shipped_date IS NOT NULL
ORDER BY days_to_ship DESC
LIMIT 5;
```

## Intermediate examples

Monthly revenue with `DATE_TRUNC` (keeps a real date, so it sorts correctly):

```sql
SELECT DATE_TRUNC('month', o.order_date)::date AS month,
       ROUND(SUM(od.unit_price * od.quantity * (1 - od.discount))::numeric, 2) AS revenue
FROM orders o
JOIN order_details od ON od.order_id = o.order_id
GROUP BY 1
ORDER BY 1;
```

Late shipments and how late they were:

```sql
SELECT order_id, required_date, shipped_date,
       shipped_date - required_date AS days_late
FROM orders
WHERE shipped_date > required_date
ORDER BY days_late DESC;
```

## Advanced examples

Employee age at hire and tenure, measured against a fixed reference date so results are stable:

```sql
SELECT first_name || ' ' || last_name AS employee,
       AGE(hire_date, birth_date)                         AS age_at_hire,
       EXTRACT(YEAR FROM AGE(DATE '2000-01-01', hire_date))::int AS tenure_years
FROM employees
ORDER BY hire_date;
```

Customers inactive for 6+ months before the latest order in the data (use the data's own "today", not `CURRENT_DATE`):

```sql
WITH ref AS (SELECT MAX(order_date) AS today FROM orders),
last_order AS (
  SELECT c.customer_id, MAX(o.order_date) AS last_date
  FROM customers c
  LEFT JOIN orders o ON o.customer_id = c.customer_id
  GROUP BY c.customer_id
)
SELECT l.customer_id, l.last_date
FROM last_order l CROSS JOIN ref
WHERE l.last_date IS NULL OR l.last_date < ref.today - INTERVAL '6 months'
ORDER BY l.last_date NULLS FIRST;
```

Orders by ISO weekday, with a readable name:

```sql
SELECT EXTRACT(ISODOW FROM order_date)::int AS dow,
       TRIM(TO_CHAR(order_date, 'Day'))      AS day_name,
       COUNT(*) AS orders
FROM orders
GROUP BY 1, 2
ORDER BY 1;
```

## Real-world scenarios

- Monthly/quarterly KPI dashboards (`DATE_TRUNC` + `GROUP BY`).
- SLA checks: shipped within N days of order.
- Cohorts: first order month per customer, then activity per later month.
- Churn: last activity older than an interval.

## PostgreSQL specifics

- `date - date` is an `integer`. Other databases use `DATEDIFF` (SQL Server, MySQL) or return fractional days (Oracle).
- `DATE_TRUNC` is PostgreSQL (also in some warehouses). SQL Server 2022 has `DATETRUNC`; MySQL has neither and uses `DATE_FORMAT` tricks.
- `timestamptz` stores an absolute instant and displays it in the session `TimeZone`. Prefer it for event times.
- `generate_series(start, stop, interval '1 month')` builds a calendar to fill gaps in time series.
- `CURRENT_DATE` and `NOW()` are fixed for the whole transaction.

## Visual explanation

```text
order_date            DATE_TRUNC('month')   EXTRACT(MONTH)   TO_CHAR(..,'Mon YYYY')
1997-03-17      ->    1997-03-01 00:00      3                'Mar 1997'
1997-03-29      ->    1997-03-01 00:00      3                'Mar 1997'
1998-03-02      ->    1998-03-01 00:00      3                'Mar 1998'
                      (distinct per year)   (merges years!)  (text: sorts wrong)
```

## Common mistakes

- Grouping by `EXTRACT(MONTH ...)` alone and merging March of different years.
- Sorting by `TO_CHAR` output: `'Apr' < 'Feb' < 'Jan'` alphabetically.
- Using `CURRENT_DATE` against historical data and getting zero rows.
- `BETWEEN '1997-01-01' AND '1997-01-31'` on a `timestamp` misses times after midnight on the 31st. Use `>= start AND < next_start`.
- Forgetting that `date + interval` returns a `timestamp`.

## Performance

- Functions on the column (`WHERE EXTRACT(YEAR FROM order_date) = 1997`) prevent a plain index on `order_date` from being used. Write a range instead: `order_date >= '1997-01-01' AND order_date < '1998-01-01'`.
- Or create an expression index on exactly the expression you filter by.

## Interview questions

### What does `date - date` return in PostgreSQL?

An `integer` number of days. `timestamp - timestamp` returns an `interval`; use `EXTRACT(EPOCH FROM ...)` to get seconds.

### DATE_TRUNC vs EXTRACT for monthly reports?

`DATE_TRUNC('month', d)` keeps year and month in one sortable value. `EXTRACT(MONTH ...)` returns only 1–12, so you must also group by year.

### How do you filter one calendar year efficiently?

A half-open range on the raw column: `d >= '1997-01-01' AND d < '1998-01-01'`. It is index-friendly and correct for timestamps.

### How do you fill months with no orders?

Generate a calendar with `generate_series`, then `LEFT JOIN` the aggregated data and `COALESCE` the measure to 0.

## Quick revision

- `EXTRACT` gives numbers; `DATE_TRUNC` gives period starts; `TO_CHAR` gives text.
- `date - date` = integer days (PostgreSQL).
- `date + INTERVAL` = timestamp.
- `AGE()` gives years/months/days intervals.
- Use half-open ranges for date filters.
- Anchor "today" to the data or a fixed date in exercises.
