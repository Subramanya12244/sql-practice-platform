---
slug: date-functions-postgresql
title: PostgreSQL Date Functions for SQL Interviews
description: Learn PostgreSQL date functions with Northwind examples: DATE_TRUNC, EXTRACT, AGE, INTERVAL arithmetic, TO_CHAR formatting and date differences in days.
keywords: postgresql date functions, date_trunc postgresql, extract year from date, postgresql age function, date difference postgresql, to_char date format, interval postgresql
questions: 110, 111, 112, 113, 114, 115, 116, 118, 119
related: year-over-year-growth, running-total, lag-and-lead, group-by-having
---

Date questions appear in almost every analyst interview: revenue by month, days to ship, customers inactive for six months, tenure in years. PostgreSQL covers them with a small set of tools: `DATE_TRUNC` to bucket dates, `EXTRACT` to pull out parts, `AGE` and plain subtraction for differences, `INTERVAL` for arithmetic, and `TO_CHAR` for labels.

## Syntax

```sql
DATE_TRUNC('month', date_col)          -- first instant of the month (timestamp)
EXTRACT(YEAR FROM date_col)            -- numeric part: YEAR, QUARTER, MONTH, DOW, DAY
date_b - date_a                        -- integer days (DATE minus DATE)
AGE(later, earlier)                    -- interval in years, months, days
date_col + INTERVAL '30 days'          -- timestamp arithmetic
date_col + 30                          -- DATE plus integer days, stays DATE
TO_CHAR(date_col, 'YYYY-MM')           -- formatted text
```

## Example

**Business question:** For the first shipped orders, show the month bucket, year, weekday, a label, days to ship and a 30-day follow-up date.

```sql
SELECT order_id,
       order_date,
       DATE_TRUNC('month', order_date)::date AS month_start,
       EXTRACT(YEAR FROM order_date)         AS yr,
       EXTRACT(DOW FROM order_date)          AS dow,
       TO_CHAR(order_date, 'YYYY-MM Dy')     AS label,
       shipped_date - order_date             AS days_to_ship,
       order_date + 30                       AS follow_up
FROM orders
WHERE shipped_date IS NOT NULL
ORDER BY order_id
LIMIT 4;
```

Illustrative result:

| order_id | order_date | month_start | yr | dow | label | days_to_ship | follow_up |
|---|---|---|---|---|---|---|---|
| 10249 | 1997-02-02 | 1997-02-01 | 1997 | 0 | 1997-02 Sun | 3 | 1997-03-04 |
| 10250 | 1998-03-03 | 1998-03-01 | 1998 | 2 | 1998-03 Tue | 3 | 1998-04-02 |
| 10251 | 1996-04-04 | 1996-04-01 | 1996 | 4 | 1996-04 Thu | 3 | 1996-05-04 |
| 10252 | 1997-05-05 | 1997-05-01 | 1997 | 1 | 1997-05 Mon | 30 | 1997-06-04 |

**Age and tenure.** The dataset ends in 1998, so use a fixed "today" of `DATE '1998-12-31'` instead of `CURRENT_DATE`:

```sql
SELECT employee_id, first_name, birth_date, hire_date,
       AGE(hire_date, birth_date) AS age_at_hire,
       EXTRACT(YEAR FROM AGE(DATE '1998-12-31', hire_date)) AS tenure_years
FROM employees
ORDER BY employee_id
LIMIT 3;
```

| employee_id | first_name | birth_date | hire_date | age_at_hire | tenure_years |
|---|---|---|---|---|---|
| 1 | Nancy | 1948-12-08 | 1992-05-01 | 43 years 4 mons 24 days | 6 |
| 2 | Andrew | 1952-02-19 | 1992-08-14 | 40 years 5 mons 24 days | 6 |
| 3 | Janet | 1963-08-30 | 1992-04-01 | 28 years 7 mons 2 days | 6 |

## How it works

- **`DATE_TRUNC`** rounds down to the start of a unit (`'year'`, `'quarter'`, `'month'`, `'week'`). It returns a timestamp, so cast with `::date` for clean output. It is the best key for monthly grouping because it keeps year and month together and sorts correctly.
- **`EXTRACT`** returns a number. `DOW` is 0 = Sunday to 6 = Saturday; `ISODOW` is 1 = Monday to 7 = Sunday.
- **`DATE - DATE`** gives an integer number of days. That is the simplest way to compute days to ship or days late, as in [Late Shipments with Days Late](/questions/q161-late-shipments-with-days-late).
- **`AGE`** returns a calendar-aware interval. Use `EXTRACT(YEAR FROM AGE(...))` for completed years.
- **`INTERVAL`** handles months and years correctly (`DATE '1998-12-31' - INTERVAL '6 months'`), which is what [Customers Inactive in Last Six Months](/questions/q167-customers-inactive-in-last-six-months) needs.
- **`TO_CHAR`** is for display only. `'Mon YYYY'`, `'YYYY-"Q"Q'` and `'Day'` are common patterns.

## Common mistakes

- **Grouping by `EXTRACT(MONTH ...)` alone.** January 1997 and January 1998 merge. Group by `DATE_TRUNC('month', ...)` or by both year and month.
- **Sorting `TO_CHAR` labels.** `'Apr'` sorts before `'Jan'` alphabetically. Sort by the underlying date.
- **Using `CURRENT_DATE` on historical data.** Every Northwind order is decades old, so "last 30 days" returns nothing. Anchor to a fixed date or `MAX(order_date)`.
- **Range filters that miss a day.** `order_date BETWEEN '1997-01-01' AND '1997-12-31'` is fine for `DATE` but drops most of Dec 31 for timestamps. Prefer `>= '1997-01-01' AND < '1998-01-01'`.
- **Forgetting NULL dates.** `shipped_date - order_date` is NULL for unshipped orders, and `AVG` silently skips them. Decide whether to filter or count them separately.
- **Mixing `DATE + INTERVAL`** produces a timestamp. Cast back with `::date` if you need a date.

## When to use it vs alternatives

| Need | Use |
|---|---|
| Group by month / quarter / year | `DATE_TRUNC` |
| Filter or label a single part (weekday, quarter number) | `EXTRACT` |
| Whole days between two dates | `date_b - date_a` |
| Years and months between dates | `AGE` |
| Add or subtract months | `+ / - INTERVAL '1 month'` |
| Human-readable label | `TO_CHAR` |

For comparisons across periods, combine these with window functions; see [year-over-year growth](/concepts/year-over-year-growth) and [running total](/concepts/running-total).

## Interview questions

### How do you group orders by month in PostgreSQL?
`GROUP BY DATE_TRUNC('month', order_date)`. It keeps the year in the key, sorts chronologically, and can be cast to `::date` for output.

### How do you calculate the number of days between two dates?
Subtract them: `shipped_date - order_date` returns an integer when both are `DATE`. For timestamps the result is an interval; use `EXTRACT(EPOCH FROM ...)/86400` or cast to `DATE` first.

### What is the difference between AGE and date subtraction?
Subtraction gives a day count. `AGE` gives a calendar interval like "43 years 4 mons 24 days", which respects month lengths and is ideal for ages and tenure.

### How do you find records from the last six months?
Filter `WHERE order_date >= anchor_date - INTERVAL '6 months'`, where the anchor is `CURRENT_DATE` in live systems or a fixed date for historical data.

## Practice

Practice this pattern with the questions below.
