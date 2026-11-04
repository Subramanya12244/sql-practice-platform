---
slug: window-functions
title: SQL Window Functions Explained with Examples
description: Learn SQL window functions with Northwind examples: OVER, PARTITION BY, ORDER BY, frames, ranking, running totals, LAG/LEAD and share of total in PostgreSQL.
keywords: sql window functions, over partition by, window function examples, sql analytic functions, window frame rows between, window functions interview questions
questions: 98, 99, 100, 101, 102, 103, 105, 106, 108
related: rank-vs-dense-rank-vs-row-number, running-total, lag-and-lead, top-n-per-group, aggregate-functions, group-by-having
---

A window function computes a value for each row using a set of related rows (its "window"), without collapsing those rows the way `GROUP BY` does. You get both the detail row and an aggregate, rank, or neighbouring value side by side. Every window function is recognised by its `OVER (...)` clause.

## Syntax

```sql
function_name(expression) OVER (
    PARTITION BY partition_col      -- optional: restart per group
    ORDER BY sort_col               -- optional: defines row order
    ROWS BETWEEN start AND end      -- optional: frame
)
```

Common functions:

- Ranking: `ROW_NUMBER()`, `RANK()`, `DENSE_RANK()`, `NTILE(n)`, `PERCENT_RANK()`
- Offset: `LAG()`, `LEAD()`, `FIRST_VALUE()`, `LAST_VALUE()`
- Aggregates used as windows: `SUM()`, `AVG()`, `COUNT()`, `MIN()`, `MAX()`

## Example

**Business question:** For each employee, show total revenue, their share of company revenue, and their rank.

```sql
SELECT e.employee_id,
       e.first_name,
       ROUND(SUM(od.unit_price * od.quantity * (1 - od.discount))::numeric, 2) AS revenue,
       ROUND((100 * SUM(od.unit_price * od.quantity * (1 - od.discount))
              / SUM(SUM(od.unit_price * od.quantity * (1 - od.discount))) OVER ())::numeric, 1) AS pct_of_total,
       RANK() OVER (ORDER BY SUM(od.unit_price * od.quantity * (1 - od.discount)) DESC) AS rnk
FROM employees e
JOIN orders o         ON o.employee_id = e.employee_id
JOIN order_details od ON od.order_id   = o.order_id
GROUP BY e.employee_id, e.first_name
ORDER BY rnk;
```

Illustrative result (top 5):

| employee_id | first_name | revenue | pct_of_total | rnk |
|---|---|---|---|---|
| 6 | Michael | 32276.55 | 23.9 | 1 |
| 4 | Margaret | 22617.81 | 16.8 | 2 |
| 2 | Andrew | 16311.83 | 12.1 | 3 |
| 9 | Anne | 14310.56 | 10.6 | 4 |
| 1 | Nancy | 13542.17 | 10.0 | 5 |

`SUM(SUM(...)) OVER ()` looks odd but is legal: the inner `SUM` is the group aggregate, the outer `SUM ... OVER ()` adds up all group totals. An empty `OVER ()` means "the whole result set is one window".

## How it works

Window functions run after `FROM`, `WHERE`, `GROUP BY` and `HAVING`, but before `ORDER BY` and `LIMIT`. So they see grouped rows if the query groups, and you cannot filter on them in `WHERE`.

- **`PARTITION BY`** splits rows into independent windows, like `GROUP BY` but without merging rows.
- **`ORDER BY`** inside `OVER` defines sequence. Ranking and `LAG`/`LEAD` need it. For aggregates, adding `ORDER BY` turns the result into a running value.
- **The frame** limits which ordered rows count. With `ORDER BY` and no explicit frame, the default is `RANGE BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW`, which is why `SUM() OVER (ORDER BY month)` is a [running total](/concepts/running-total). A 3-month moving average uses `ROWS BETWEEN 2 PRECEDING AND CURRENT ROW`.

```sql
-- Named window: reuse one definition
SELECT product_name, unit_price,
       RANK()       OVER w AS rnk,
       DENSE_RANK() OVER w AS dense_rnk
FROM products
WINDOW w AS (ORDER BY unit_price DESC);
```

## Common mistakes

- **Filtering in `WHERE`.** `WHERE RANK() OVER (...) = 1` fails. Wrap the query in a CTE and filter outside.
- **Default frame surprises.** `LAST_VALUE(x) OVER (ORDER BY d)` returns the current row's value because the default frame ends at the current row. Add `ROWS BETWEEN UNBOUNDED PRECEDING AND UNBOUNDED FOLLOWING`.
- **`RANGE` vs `ROWS` with ties.** Under the default `RANGE` frame, rows with equal `ORDER BY` values are peers and are summed together. Use `ROWS` for a strict row-by-row running total.
- **Mixing levels.** Window functions over raw order lines produce line-level results. Aggregate first (often in a CTE), then apply the window.
- **Expecting fewer rows.** A window function never removes rows. Use `GROUP BY` when you want one row per group.

## When to use it vs alternatives

| Need | Window function | Alternative |
|---|---|---|
| Group total next to each row | `SUM(x) OVER (PARTITION BY g)` | Join to a grouped subquery |
| Top N per group | `ROW_NUMBER()` + filter | `LATERAL`, correlated subquery |
| Previous row value | `LAG()` | Self-join on row number |
| Running total | `SUM() OVER (ORDER BY ...)` | Correlated subquery (slow) |

Use `GROUP BY` alone when you only need one summary row per group. See [aggregate functions](/concepts/aggregate-functions) and [GROUP BY and HAVING](/concepts/group-by-having).

## Interview questions

### What is the difference between GROUP BY and a window function?
`GROUP BY` collapses rows so each group returns one row. A window function keeps every input row and adds a computed column based on its window. You can combine them: aggregate with `GROUP BY`, then rank the groups with a window.

### Why can't I use a window function in WHERE?
`WHERE` is evaluated before window functions are computed, so the value does not exist yet. Compute it in a subquery or CTE, then filter on the alias in the outer query.

### What does PARTITION BY do?
It divides rows into groups, and the window function restarts for each group. Without it, the whole result set is one partition.

### What is a window frame?
The frame is the subset of ordered rows within the partition that an aggregate uses for the current row, such as `ROWS BETWEEN 2 PRECEDING AND CURRENT ROW`. It drives moving averages and running totals.

### What does OVER () with nothing inside mean?
The window is the entire result set. `SUM(x) OVER ()` puts the grand total on every row, which is useful for percent-of-total calculations.

## Practice

Practice this pattern with the questions below.
