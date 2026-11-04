---
slug: leetcode-sql-patterns
title: LeetCode SQL Patterns: The 8 You Need for Interviews
description: The eight SQL patterns behind most LeetCode and interview problems: anti-join, second highest, duplicates, top N per group, running totals, LAG and pivots.
keywords: leetcode sql patterns, leetcode sql 50, sql interview patterns, common sql problems, sql practice patterns, sql coding interview
questions: 28, 99, 98, 100, 101, 103, 131, 64
related: second-highest-value, find-duplicates, top-n-per-group, running-total, gaps-and-islands, pivot-rows-to-columns
---

LeetCode-style SQL problems look endless, but nearly all of them are a handful of patterns in different clothes. Recognise the pattern and the query almost writes itself. This guide lists the eight that cover most of the "SQL 50" style lists and most real interview screens, each with a runnable Northwind example.

## Syntax

```sql
-- The skeleton most answers share
WITH step AS (
    SELECT key, aggregate_or_window
    FROM ...
    GROUP BY key
)
SELECT ...
FROM step
WHERE filter_on_computed_column;
```

## Example

**Pattern 1, anti-join:** "Customers who never ordered."

```sql
SELECT c.customer_id, c.company_name
FROM customers c
WHERE NOT EXISTS (
    SELECT 1 FROM orders o WHERE o.customer_id = c.customer_id
)
ORDER BY c.customer_id;
```

| customer_id | company_name |
|---|---|
| FISSA | FISSA Fabrica Inter. Salchichas |
| PARIS | Paris spécialités |

## How it works

Each pattern below names the signal in the problem statement and the tool to reach for.

**Pattern 2, second or Nth highest.** Signal: "second highest", "Nth largest". Tool: `DISTINCT ... OFFSET N-1 LIMIT 1` wrapped in a scalar subquery so that missing values return `NULL`. See [second highest value](/concepts/second-highest-value).

```sql
SELECT (SELECT DISTINCT unit_price FROM products
        ORDER BY unit_price DESC OFFSET 1 LIMIT 1) AS second_highest;
```

| second_highest |
|---|
| 123.79 |

**Pattern 3, duplicates.** Signal: "duplicate emails", "appears more than once". Tool: `GROUP BY ... HAVING COUNT(*) > 1`, or `ROW_NUMBER()` to delete all but one. See [find duplicates](/concepts/find-duplicates).

```sql
SELECT country, COUNT(*) AS customers
FROM customers
GROUP BY country
HAVING COUNT(*) > 10
ORDER BY customers DESC, country;
```

| country | customers |
|---|---|
| USA | 13 |
| France | 11 |
| Germany | 11 |

**Pattern 4, self join.** Signal: "employees earning more than their manager", "pairs". Tool: join the table to itself on the relationship column.

```sql
SELECT e.first_name || ' ' || e.last_name AS employee,
       m.first_name || ' ' || m.last_name AS manager
FROM employees e
LEFT JOIN employees m ON m.employee_id = e.reports_to
ORDER BY e.employee_id
LIMIT 4;
```

| employee | manager |
|---|---|
| Nancy Davolio | Andrew Fuller |
| Andrew Fuller | |
| Janet Leverling | Andrew Fuller |
| Margaret Peacock | Andrew Fuller |

**Pattern 5, top N per group.** Signal: "top 3 per department", "highest in each". Tool: `DENSE_RANK() OVER (PARTITION BY ...)` filtered in an outer query. See [top N per group](/concepts/top-n-per-group).

**Pattern 6, running total.** Signal: "cumulative", "to date". Tool: `SUM(...) OVER (ORDER BY ...)`. See [running total](/concepts/running-total).

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
       ROUND(SUM(revenue) OVER (ORDER BY month)::numeric, 2) AS running_total
FROM monthly
ORDER BY month
LIMIT 4;
```

| month | revenue | running_total |
|---|---|---|
| 1996-01-01 | 5217.41 | 5217.41 |
| 1996-04-01 | 18574.06 | 23791.47 |
| 1996-07-01 | 19336.35 | 43127.82 |
| 1996-10-01 | 9197.44 | 52325.26 |

**Pattern 7, compare with previous row.** Signal: "rising temperature", "consecutive", "growth", "days since". Tool: `LAG` or `LEAD`, or the [gaps and islands](/concepts/gaps-and-islands) trick for streaks.

**Pattern 8, pivot.** Signal: "one column per month/status". Tool: `SUM(...) FILTER (WHERE ...)` or `SUM(CASE WHEN ...)`. See [pivot rows to columns](/concepts/pivot-rows-to-columns).

## Common mistakes

- **Returning no rows when the grader wants `NULL`.** Wrap single-value answers in a scalar subquery.
- **Using `NOT IN` against a column with `NULL`s.** If the subquery returns any `NULL`, `NOT IN` returns nothing. Prefer `NOT EXISTS`.
- **`ROW_NUMBER` when ties matter.** "Highest salary in each department" usually wants every tied employee: use `RANK` or `DENSE_RANK`.
- **Filtering a window function in `WHERE`.** Compute it in a CTE first.
- **Forgetting the required output order or column names.** Graders compare exactly.

## When to use it vs alternatives

| Problem signal | Pattern |
|---|---|
| "never", "without", "no matching" | Anti-join (`NOT EXISTS`, `LEFT JOIN ... IS NULL`) |
| "second highest", "Nth" | `OFFSET` or `DENSE_RANK` |
| "duplicate", "more than once" | `GROUP BY ... HAVING` |
| "manager", "pairs", "same X" | Self join |
| "top N in each" | Partitioned ranking |
| "cumulative", "to date" | `SUM() OVER` |
| "previous", "consecutive", "streak" | `LAG`/`LEAD`, gaps and islands |
| "one column per" | Conditional aggregation |

## Interview questions

### What SQL topics does LeetCode test most?
Joins and anti-joins, `GROUP BY` with `HAVING`, subqueries, window functions (`RANK`, `DENSE_RANK`, `ROW_NUMBER`, `LAG`, `LEAD`, running `SUM`), date arithmetic and `CASE`. Window functions appear in most medium and hard problems.

### How should I practise LeetCode SQL efficiently?
Group problems by pattern rather than by number. Solve two or three of each pattern until you recognise the signal words, then mix them. Always check ties, `NULL`s and empty results.

### Is NOT IN or NOT EXISTS better for anti-joins?
`NOT EXISTS` is safer. `NOT IN` returns no rows if the subquery contains any `NULL`, while `NOT EXISTS` behaves as expected and usually gets the same anti-join plan.

### How do I avoid getting the wrong answer on ties?
Read whether the question wants every tied row or exactly N rows. Use `DENSE_RANK` or `RANK` for "all tied", `ROW_NUMBER` with a tiebreaker for exactly N, and `DISTINCT` before `OFFSET` for Nth distinct value.

## Practice

Practice this pattern with the questions below.
