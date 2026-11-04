---
slug: group-by-having
title: SQL GROUP BY and HAVING Explained with Examples
description: Learn SQL GROUP BY and HAVING with Northwind examples: how grouping works, WHERE vs HAVING, filtering aggregates, and common interview mistakes to avoid.
keywords: sql group by, sql having, where vs having, group by having example, filter aggregate sql
questions: 6, 7, 8, 9, 10, 12, 13, 92
related: aggregate-functions, cte, count-star-vs-count-column
---

`GROUP BY` collapses rows that share the same values in one or more columns into a single summary row, so you can compute aggregates such as `SUM`, `COUNT`, or `AVG` per group. `HAVING` filters those groups after the aggregates are computed. Together they answer questions like "which customers spent more than $10,000?" — a question `WHERE` alone cannot answer.

## Syntax

```sql
SELECT group_col, AGG_FUNC(value_col) AS metric
FROM some_table
WHERE row_condition          -- filters rows BEFORE grouping
GROUP BY group_col
HAVING AGG_FUNC(value_col) > threshold   -- filters groups AFTER grouping
ORDER BY metric DESC;
```

## Example

**Business question:** Which customers have generated more than $5,000 in net revenue?

```sql
SELECT c.customer_id,
       c.company_name,
       ROUND(SUM(od.unit_price * od.quantity * (1 - od.discount))::numeric, 2) AS revenue
FROM customers c
JOIN orders o         ON o.customer_id = c.customer_id
JOIN order_details od ON od.order_id   = o.order_id
GROUP BY c.customer_id, c.company_name
HAVING SUM(od.unit_price * od.quantity * (1 - od.discount)) > 5000
ORDER BY revenue DESC;
```

Result:

| customer_id | company_name | revenue |
|---|---|---|
| FOLKO | Folk och fä HB | 12905.32 |
| GOURL | Gourmet Lanchonetes | 9578.85 |
| BOLID | Bólido Comidas preparadas | 8095.04 |

## How it works

PostgreSQL evaluates a grouped query in this logical order: `FROM`/`JOIN` → `WHERE` → `GROUP BY` → aggregates → `HAVING` → `SELECT` → `ORDER BY` → `LIMIT`.

- **`WHERE` filters individual rows.** It runs before grouping, so it cannot reference `SUM(...)` or any other aggregate.
- **`GROUP BY` sets the grain.** After grouping, each output row represents one group. Every column in `SELECT` must either appear in `GROUP BY` or be wrapped in an aggregate. PostgreSQL relaxes this when you group by a primary key: grouping by `c.customer_id` lets you select `c.company_name` because it is functionally dependent.
- **`HAVING` filters groups.** It sees one row per group and can compare aggregate values.
- **Aliases:** PostgreSQL allows `ORDER BY revenue`, but not `HAVING revenue > 5000`, because `HAVING` is evaluated before `SELECT` aliases exist. Repeat the expression.

A frequent interview variant is "above average": compare each group to the average of all groups. That needs two passes, because aggregates cannot be nested (`AVG(SUM(...))` is an error):

```sql
WITH customer_revenue AS (
    SELECT o.customer_id,
           SUM(od.unit_price * od.quantity * (1 - od.discount)) AS revenue
    FROM orders o
    JOIN order_details od ON od.order_id = o.order_id
    GROUP BY o.customer_id
)
SELECT customer_id, revenue
FROM customer_revenue
WHERE revenue > (SELECT AVG(revenue) FROM customer_revenue)
ORDER BY revenue DESC;
```

You could also write the outer filter as `HAVING SUM(...) > (SELECT AVG(...) FROM (...) t)` directly on the grouped query; the CTE version is easier to read.

## Common mistakes

- **Using `WHERE` for an aggregate condition.** `WHERE SUM(quantity) > 100` raises "aggregate functions are not allowed in WHERE". Move it to `HAVING`.
- **Using `HAVING` for a row condition.** `HAVING country = 'Germany'` works only if `country` is grouped, and it filters later than needed. Put row filters in `WHERE` so fewer rows are grouped.
- **Grouping by display names instead of keys.** Two employees can share a name. Group by `employee_id` (and add the name columns), not by `first_name` alone.
- **Nesting aggregates.** `AVG(COUNT(*))` is invalid. Aggregate per group in a CTE or derived table, then aggregate again.
- **Averaging at the wrong grain.** "Average order value" means total revenue per order, averaged across orders. Averaging line-item revenue gives a different, smaller number. Build the per-order totals first, then `AVG` them.
- **Fan-out inflating counts.** Joining `orders` to `order_details` repeats each order once per line. Use `COUNT(DISTINCT o.order_id)` when counting orders after that join.

## When to use it vs alternatives

| Need | Use |
|---|---|
| One summary row per group | `GROUP BY` |
| Filter groups by an aggregate | `HAVING` |
| Keep every detail row and show its group total next to it | Window function: `SUM(...) OVER (PARTITION BY ...)` |
| Compare a group to the average of all groups | CTE + scalar subquery, or `HAVING` with a subquery |
| Remove duplicate rows without aggregation | `SELECT DISTINCT` |

Window functions do not collapse rows, so they suit "show each product and its category total". `GROUP BY` suits reports where one row per entity is the goal.

## Interview questions

### What is the difference between WHERE and HAVING?
`WHERE` filters individual rows before grouping and cannot use aggregate functions. `HAVING` filters groups after aggregation and can reference aggregates like `SUM` or `COUNT`. Put row-level conditions in `WHERE` for efficiency, and aggregate conditions in `HAVING`.

### Can you use HAVING without GROUP BY?
Yes. Without `GROUP BY`, the whole result is treated as one group, so `HAVING` decides whether that single summary row is returned. For example, `SELECT COUNT(*) FROM orders HAVING COUNT(*) > 500` returns one row or none.

### Why does PostgreSQL say a column must appear in the GROUP BY clause?
After grouping, each output row represents many input rows, so a non-aggregated column would be ambiguous. Every selected column must be grouped or aggregated. PostgreSQL allows exceptions only when the column is functionally dependent on a grouped primary key.

### How do you find groups above the overall average?
Compute the per-group aggregate first in a CTE or derived table, then compare each value to `AVG` of that set with a scalar subquery. You cannot nest `AVG(SUM(...))` directly in one level.

## Practice

Practice this pattern with the questions below.
