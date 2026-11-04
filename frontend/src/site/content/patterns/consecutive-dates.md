---
title: Consecutive dates
slug: consecutive-dates
category: dates
difficulty: Advanced
description: Detect consecutive days or streaks with LAG date differences, or with the date minus ROW_NUMBER trick, and find the longest streak.
questions: [104, 109, 112]
notes: [lag, row-number, date-time-functions, window-order-by]
guides: [gaps-and-islands, lag-and-lead]
---

## Problem

Find rows that fall on consecutive days and measure each streak. Example: "activity days" on which an order was placed or shipped. In this Northwind copy order dates alone never fall on two consecutive days, so the solution combines `order_date` and `shipped_date`.

## When to use it

- Login or activity streaks.
- "Three consecutive days with sales" interview questions.
- Checking a daily feed for continuity.

## Solution

Group consecutive activity days into streaks with the date-minus-row-number trick:

```sql
WITH days AS (
  SELECT order_date AS d FROM orders
  UNION
  SELECT shipped_date FROM orders WHERE shipped_date IS NOT NULL
),
grp AS (
  SELECT d, d - (ROW_NUMBER() OVER (ORDER BY d))::int AS streak_key
  FROM days
)
SELECT MIN(d) AS streak_start, MAX(d) AS streak_end, COUNT(*) AS days
FROM grp
GROUP BY streak_key
HAVING COUNT(*) >= 2
ORDER BY days DESC, streak_start
LIMIT 10;
```

## Alternatives

Check the previous date with `LAG` (good for "is this day consecutive with the previous one"):

```sql
WITH days AS (SELECT DISTINCT order_date AS d FROM orders)
SELECT d,
       LAG(d) OVER (ORDER BY d) AS prev_day,
       d - LAG(d) OVER (ORDER BY d) AS gap_days
FROM days
ORDER BY d
LIMIT 10;
```

Per customer, the gap in days between consecutive orders:

```sql
SELECT customer_id, order_date,
       order_date - LAG(order_date) OVER (PARTITION BY customer_id ORDER BY order_date) AS days_since_prev
FROM orders
ORDER BY customer_id, order_date
LIMIT 15;
```

`LAG` answers pairwise questions. Grouping whole streaks needs the row-number trick or a running sum of "new streak" flags (see the gaps-and-islands pattern).

## How it works

When dates are consecutive, the date and its row number both increase by 1, so `date - row_number` stays constant. A gap increases the date by more than 1, so the difference changes and a new group starts. Group by that constant to get each streak.

## Execution walkthrough

1. `days` combines both date columns. `UNION` removes repeated dates, because two events on one day would break the arithmetic.
2. `ROW_NUMBER` numbers dates 1, 2, 3, … in order.
3. `d - rn` gives the same value for every date in a run of consecutive days.
4. `GROUP BY streak_key` turns each run into one row with its start, end and length.
5. `HAVING COUNT(*) >= 2` keeps real streaks.

## Common mistakes

- Keeping duplicate dates (`UNION ALL` or no `DISTINCT`). Duplicate dates give row numbers that advance without the date, so streaks split.
- Subtracting a `bigint` from a date. `ROW_NUMBER` returns `bigint`, so cast it to `int` first.
- Using `LAG` alone to measure streak length. It only compares neighbours.

## Performance

One sort for the window, then a hash aggregate. An index on the date column speeds up `DISTINCT`.
