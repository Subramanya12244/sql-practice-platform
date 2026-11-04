---
title: Monthly cohort retention
slug: cohort-retention
dataset: ecommerce
difficulty: Hard
description: Group customers by first-order month and measure how many ordered again in the following calendar month.
orderBy: cohort_month
notes: [min-max, date-time-functions, exists-not-exists, cte]
patterns: []
---

## Business context
The growth team wants to know whether newly acquired customers come back. They define a customer's cohort as the month of their first order and want, for each cohort, the share of customers who ordered again in the very next calendar month.

## Problem
For each cohort month, count the customers in the cohort and how many placed at least one order in the following calendar month, and compute the retention rate.

## Available data
- `orders`: `order_id`, `user_id`, `order_date` (timestamp), `status`
- `users`: `user_id`, `is_deleted` (not needed for this report)

## Expected outcome
The team compares retention across cohorts to judge which acquisition campaigns brought loyal customers.

## Success criteria
- Output columns, exactly: `cohort_month`, `cohort_size`, `retained_next_month`, `retention_pct`
- `cohort_month` is text `YYYY-MM` of the user's first order (all statuses count as orders, including for soft-deleted users).
- `retained_next_month` = cohort users with ≥1 order in the calendar month after the cohort month.
- `retention_pct` = 100 * retained / size, rounded with `ROUND(x::numeric, 2)`.
- Exclude the last cohort month in the data (its next month is not observable).
- Sort by `cohort_month`.

```solution
WITH firsts AS (
  SELECT user_id, date_trunc('month', MIN(order_date)) AS cohort
  FROM orders
  GROUP BY user_id
),
activity AS (
  SELECT DISTINCT user_id, date_trunc('month', order_date) AS m
  FROM orders
)
SELECT to_char(f.cohort, 'YYYY-MM') AS cohort_month,
       COUNT(*) AS cohort_size,
       COUNT(a.user_id) AS retained_next_month,
       ROUND((100.0 * COUNT(a.user_id) / COUNT(*))::numeric, 2) AS retention_pct
FROM firsts f
LEFT JOIN activity a ON a.user_id = f.user_id AND a.m = f.cohort + INTERVAL '1 month'
WHERE f.cohort < (SELECT date_trunc('month', MAX(order_date)) FROM orders)
GROUP BY f.cohort
ORDER BY cohort_month;
```

```alternative
WITH firsts AS (
  SELECT DISTINCT ON (user_id) user_id, date_trunc('month', order_date) AS cohort
  FROM orders
  ORDER BY user_id, order_date
),
flagged AS (
  SELECT f.cohort,
         EXISTS (SELECT 1 FROM orders o
                 WHERE o.user_id = f.user_id
                   AND o.order_date >= f.cohort + INTERVAL '1 month'
                   AND o.order_date <  f.cohort + INTERVAL '2 months') AS retained
  FROM firsts f
)
SELECT to_char(cohort, 'YYYY-MM') AS cohort_month,
       COUNT(*) AS cohort_size,
       COUNT(*) FILTER (WHERE retained) AS retained_next_month,
       ROUND((100.0 * COUNT(*) FILTER (WHERE retained) / COUNT(*))::numeric, 2) AS retention_pct
FROM flagged
WHERE cohort < (SELECT date_trunc('month', MAX(order_date)) FROM orders)
GROUP BY cohort
ORDER BY cohort_month;
```

## Explanation
Cohort analysis has two steps: assign each user a cohort (their first activity month), then test for activity in a later period. The solution deduplicates activity to one row per user-month so the LEFT JOIN cannot double count, and counts matches. The alternative picks the first order with `DISTINCT ON` and flags retention with an `EXISTS` over a half-open date range. The final cohort is excluded because its next month lies beyond the data and would show 0% retention misleadingly.

## Follow-up questions
### How would you build a full retention triangle (month 1, 2, 3...)?
Compute `months_since = (year diff * 12 + month diff)` for every user-month, then pivot with `COUNT(DISTINCT user_id) FILTER (WHERE months_since = k)`.
### Should cancelled orders count?
For a "purchase" definition, filter `status NOT IN ('cancelled')` in both CTEs; the business must decide.
