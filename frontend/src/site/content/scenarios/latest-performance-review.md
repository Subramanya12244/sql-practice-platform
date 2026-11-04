---
title: Latest completed review per employee
slug: latest-performance-review
dataset: hr
difficulty: Medium
description: Show each active employee's most recent completed performance review, keeping employees with no completed review.
notes: [row-number, left-join, null-handling]
patterns: [latest-record-per-group]
---

## Business context
HR business partners are preparing promotion talks and need each current employee's latest finished review. Reviews still in progress have no rating yet and must not count, and staff who were never reviewed should still be listed so managers can schedule one.

## Problem
For every active employee, return the date and rating of their most recent performance review that has a rating. Employees without any rated review appear with empty review fields.

## Available data
- `employees`: `employee_id`, `first_name`, `last_name`, `is_active`
- `performance_reviews`: `review_id`, `employee_id`, `review_date`, `rating` (NULL while in progress)

## Expected outcome
Managers use the list to prepare promotion cases and to chase missing reviews.

## Success criteria
- Output columns, exactly: `employee_id`, `full_name`, `last_review_date`, `last_rating`
- `full_name` = `first_name || ' ' || last_name`.
- Only active employees (`is_active = TRUE`), one row each.
- Reviews with NULL `rating` are ignored.
- Employees with no rated review have NULL `last_review_date` and `last_rating`.

```solution
WITH ranked AS (
  SELECT r.employee_id, r.review_date, r.rating,
         ROW_NUMBER() OVER (PARTITION BY r.employee_id ORDER BY r.review_date DESC, r.review_id DESC) AS rn
  FROM performance_reviews r
  WHERE r.rating IS NOT NULL
)
SELECT e.employee_id, e.first_name || ' ' || e.last_name AS full_name,
       rk.review_date AS last_review_date, rk.rating AS last_rating
FROM employees e
LEFT JOIN ranked rk ON rk.employee_id = e.employee_id AND rk.rn = 1
WHERE e.is_active;
```

```alternative
SELECT e.employee_id, e.first_name || ' ' || e.last_name AS full_name,
       lr.review_date AS last_review_date, lr.rating AS last_rating
FROM employees e
LEFT JOIN LATERAL (
  SELECT r.review_date, r.rating
  FROM performance_reviews r
  WHERE r.employee_id = e.employee_id AND r.rating IS NOT NULL
  ORDER BY r.review_date DESC, r.review_id DESC
  LIMIT 1
) lr ON TRUE
WHERE e.is_active;
```

```alternative
SELECT e.employee_id, e.first_name || ' ' || e.last_name AS full_name,
       d.review_date AS last_review_date, d.rating AS last_rating
FROM employees e
LEFT JOIN (
  SELECT DISTINCT ON (employee_id) employee_id, review_date, rating
  FROM performance_reviews
  WHERE rating IS NOT NULL
  ORDER BY employee_id, review_date DESC, review_id DESC
) d ON d.employee_id = e.employee_id
WHERE e.is_active;
```

## Explanation
Filter out in-progress reviews first, then pick the newest row per employee. `ROW_NUMBER` with `rn = 1`, a `LATERAL ... LIMIT 1` and `DISTINCT ON` are three ways to say "latest per group". The rn filter belongs in the join condition, not in `WHERE`, otherwise the LEFT JOIN turns into an inner join and unreviewed employees vanish.

## Follow-up questions
### What changes if two reviews share the same date?
`review_id DESC` is the tie-breaker; without it the choice between same-day reviews would be arbitrary.
### How would you list only employees with no rated review?
Keep the same query and filter `WHERE last_review_date IS NULL`, or use `NOT EXISTS` against rated reviews.
