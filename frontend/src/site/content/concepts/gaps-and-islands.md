---
slug: gaps-and-islands
title: SQL Gaps and Islands: Find Streaks and Missing Ranges
description: Solve SQL gaps and islands with LAG, LEAD and the ROW_NUMBER difference trick: find missing date ranges, activity streaks and sessions on Northwind.
keywords: gaps and islands sql, consecutive days sql, sql streaks, row_number difference, find missing dates sql, sessionization sql
questions: 104, 109, 103, 118
related: lag-and-lead, window-functions, running-total, cte
---

"Gaps and islands" describes any problem where you need to group consecutive rows into runs (islands) or find the holes between them (gaps). Typical interview versions: longest login streak, missing invoice numbers, periods with no sales, or grouping events into sessions. The two standard tools are `LAG`/`LEAD` to compare each row with its neighbour, and the difference of two `ROW_NUMBER`s to label each run.

## Syntax

```sql
-- Gaps: compare each value with the next one
SELECT val, next_val
FROM (SELECT val, LEAD(val) OVER (ORDER BY val) AS next_val FROM t) x
WHERE next_val - val > 1;

-- Islands: flag starts, then running-sum the flags
WITH flagged AS (
    SELECT val,
           CASE WHEN val - LAG(val) OVER (ORDER BY val) <= threshold THEN 0 ELSE 1 END AS new_island
    FROM t
)
SELECT val, SUM(new_island) OVER (ORDER BY val) AS island_id
FROM flagged;
```

## Example

**Business question:** Find the longest stretches with no orders at all.

```sql
SELECT order_date AS gap_after,
       next_date  AS gap_before,
       next_date - order_date - 1 AS missing_days
FROM (
    SELECT order_date,
           LEAD(order_date) OVER (ORDER BY order_date) AS next_date
    FROM (SELECT DISTINCT order_date FROM orders) d
) x
WHERE next_date - order_date > 1
ORDER BY missing_days DESC, gap_after
LIMIT 5;
```

| gap_after | gap_before | missing_days |
|---|---|---|
| 1996-10-26 | 1997-02-02 | 98 |
| 1997-11-27 | 1998-03-03 | 95 |
| 1997-05-25 | 1997-08-04 | 70 |
| 1996-01-25 | 1996-04-04 | 69 |
| 1998-09-25 | 1998-12-04 | 69 |

## How it works

1. `DISTINCT order_date` reduces the data to one row per active day.
2. `LEAD` puts the next active day beside each row. Subtracting two `DATE`s in PostgreSQL gives an integer number of days.
3. Any difference above 1 is a gap; `next_date - order_date - 1` counts the empty days inside it.

**Islands with a tolerance (sessions).** Treat order days less than a week apart as one burst of activity. Flag each row that starts a new island, then a running `SUM` of the flags becomes the island id:

```sql
WITH d AS (
    SELECT DISTINCT order_date FROM orders
),
flagged AS (
    SELECT order_date,
           CASE WHEN order_date - LAG(order_date) OVER (ORDER BY order_date) <= 7
                THEN 0 ELSE 1 END AS new_island
    FROM d
),
numbered AS (
    SELECT order_date,
           SUM(new_island) OVER (ORDER BY order_date) AS island_id
    FROM flagged
)
SELECT island_id,
       MIN(order_date) AS island_start,
       MAX(order_date) AS island_end,
       COUNT(*)        AS order_days
FROM numbered
GROUP BY island_id
ORDER BY island_id
LIMIT 4;
```

| island_id | island_start | island_end | order_days |
|---|---|---|---|
| 1 | 1996-01-01 | 1996-01-25 | 7 |
| 2 | 1996-04-04 | 1996-04-28 | 7 |
| 3 | 1996-07-03 | 1996-07-27 | 7 |
| 4 | 1996-10-02 | 1996-10-26 | 7 |

**Islands of the same value (the ROW_NUMBER difference trick).** To find runs of consecutive orders handled by the same shipper, subtract a per-shipper row number from a global row number. Inside a run both counters rise together, so their difference stays constant and labels the run:

```sql
WITH s AS (
    SELECT order_id, order_date, ship_via,
           ROW_NUMBER() OVER (ORDER BY order_date, order_id)
         - ROW_NUMBER() OVER (PARTITION BY ship_via ORDER BY order_date, order_id) AS grp
    FROM orders
)
SELECT ship_via,
       MIN(order_date) AS streak_start,
       MAX(order_date) AS streak_end,
       COUNT(*)        AS consecutive_orders
FROM s
GROUP BY ship_via, grp
ORDER BY consecutive_orders DESC, streak_start;
```

| ship_via | streak_start | streak_end | consecutive_orders |
|---|---|---|---|
| 1 | 1996-01-01 | 1996-10-26 | 34 |
| 2 | 1997-02-02 | 1997-11-27 | 33 |
| 3 | 1998-03-03 | 1998-12-28 | 33 |

For strictly consecutive integers or days, the simpler form is `val - ROW_NUMBER() OVER (ORDER BY val)`, which is constant within each run.

## Common mistakes

- **Not deduplicating first.** Two orders on the same day break the `date - ROW_NUMBER()` trick. Use `DISTINCT` or `DENSE_RANK`.
- **Missing tiebreakers.** Both `ROW_NUMBER`s need the same deterministic `ORDER BY`, or runs split randomly.
- **Grouping by the label alone.** In the same-value version, group by the value and the label together.
- **Off-by-one gap sizes.** The number of missing days is `next - current - 1`, not `next - current`.

## When to use it vs alternatives

| Problem | Technique |
|---|---|
| Find missing ranges | `LEAD` and keep rows where the step is above 1 |
| Runs of consecutive numbers or days | `val - ROW_NUMBER()` |
| Runs of the same status or value | Difference of two `ROW_NUMBER`s |
| Sessions with a time-out | `LAG` flag plus running `SUM` |
| Full calendar of missing days | `generate_series` with a `LEFT JOIN` |

## Interview questions

### What is the gaps and islands problem in SQL?
It is any task that groups consecutive rows into runs (islands) or finds the missing ranges between them (gaps), such as login streaks, missing IDs or periods without sales.

### How do you find consecutive days in SQL?
Deduplicate to one row per day, compute `day - ROW_NUMBER() OVER (ORDER BY day)`, and group by that value. Consecutive days share the same result, so `COUNT(*)` gives streak length and `MIN`/`MAX` give its bounds.

### How do you find missing numbers in a sequence?
Use `LEAD(id) OVER (ORDER BY id)` and keep rows where `next_id - id > 1`. The gap runs from `id + 1` to `next_id - 1`. Alternatively, `LEFT JOIN` against `generate_series` and keep `NULL` matches.

### How do you split events into sessions with a 30-minute timeout?
Flag each event whose gap from the previous event (via `LAG`) exceeds the timeout, then take a running `SUM` of the flag partitioned by user. That running sum is the session id.

## Practice

Practice this pattern with the questions below.
