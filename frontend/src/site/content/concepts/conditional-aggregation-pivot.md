---
slug: conditional-aggregation-pivot
title: Pivot Rows to Columns in SQL with CASE WHEN / FILTER
description: Pivot rows to columns in SQL with conditional aggregation: SUM(CASE WHEN) and PostgreSQL FILTER, with Northwind orders per employee per year and ship status.
keywords: sql pivot rows to columns, conditional aggregation sql, sum case when, count filter where postgresql, pivot without pivot function, crosstab sql
questions: 111, 113, 116, 117, 86, 33
related: aggregate-functions, group-by-having, year-over-year-growth, null-handling-coalesce
---

Conditional aggregation puts a condition inside an aggregate, so one `GROUP BY` query can produce several counts or sums side by side. It is the portable way to pivot rows into columns: one column per year, per status, or per category. PostgreSQL adds the cleaner `FILTER (WHERE ...)` syntax for the same idea.

## Syntax

```sql
SELECT group_col,
       SUM(CASE WHEN condition_a THEN value ELSE 0 END) AS col_a,
       COUNT(*) FILTER (WHERE condition_b)           AS col_b,
       SUM(value) FILTER (WHERE condition_c)         AS col_c
FROM some_table
GROUP BY group_col;
```

## Example

**Business question:** How many orders did each employee handle in 1996, 1997 and 1998?

```sql
SELECT e.employee_id,
       e.first_name,
       COUNT(*) FILTER (WHERE EXTRACT(YEAR FROM o.order_date) = 1996) AS y1996,
       COUNT(*) FILTER (WHERE EXTRACT(YEAR FROM o.order_date) = 1997) AS y1997,
       COUNT(*) FILTER (WHERE EXTRACT(YEAR FROM o.order_date) = 1998) AS y1998,
       COUNT(*) AS total
FROM employees e
JOIN orders o ON o.employee_id = e.employee_id
GROUP BY e.employee_id, e.first_name
ORDER BY e.employee_id;
```

Illustrative result (first rows):

| employee_id | first_name | y1996 | y1997 | y1998 | total |
|---|---|---|---|---|---|
| 1 | Nancy | 11 | 0 | 0 | 11 |
| 2 | Andrew | 0 | 11 | 0 | 11 |
| 3 | Janet | 0 | 0 | 11 | 11 |
| 4 | Margaret | 11 | 0 | 0 | 11 |
| 6 | Michael | 0 | 11 | 11 | 22 |

The same pivot with `CASE`, which works in every SQL database, here for shipping status per shipper:

```sql
SELECT s.company_name AS shipper,
       SUM(CASE WHEN o.shipped_date IS NULL THEN 1 ELSE 0 END)            AS unshipped,
       SUM(CASE WHEN o.shipped_date > o.required_date THEN 1 ELSE 0 END)  AS late,
       SUM(CASE WHEN o.shipped_date <= o.required_date THEN 1 ELSE 0 END) AS on_time
FROM shippers s
JOIN orders o ON o.ship_via = s.shipper_id
GROUP BY s.company_name
ORDER BY s.company_name;
```

| shipper | unshipped | late | on_time |
|---|---|---|---|
| Federal Shipping | 5 | 3 | 25 |
| Speedy Express | 5 | 3 | 26 |
| United Package | 5 | 2 | 26 |

## How it works

1. `GROUP BY` defines the rows of the pivot (employee, shipper).
2. Each aggregate defines a column. The `CASE` or `FILTER` decides which rows contribute to that column; other rows add 0 (or nothing).
3. Because every column comes from the same scan, the query reads the table once, unlike one subquery per column.

`COUNT(*) FILTER (WHERE x)` is equivalent to `SUM(CASE WHEN x THEN 1 ELSE 0 END)` and to `COUNT(CASE WHEN x THEN 1 END)`. The last form works because `COUNT` ignores NULLs and a `CASE` without `ELSE` returns NULL.

Ratios fall out naturally: `AVG(CASE WHEN late THEN 1.0 ELSE 0 END)` is the late-shipment rate.

## Common mistakes

- **`COUNT(CASE WHEN x THEN 1 ELSE 0 END)`.** `COUNT` counts 0 as a value, so this counts every row. Use `SUM` with `ELSE 0`, or `COUNT` without `ELSE`.
- **Missing `ELSE 0` in `SUM(CASE ...)`.** If no rows match, the result is NULL instead of 0. Add `ELSE 0` or wrap with `COALESCE`.
- **Filtering in `WHERE` instead.** `WHERE year = 1997` removes the other years' rows before aggregation, so the other columns become empty.
- **Hard-coded column list.** SQL needs columns known in advance. A new year needs a new line; truly dynamic pivots require generated SQL or `crosstab` from the `tablefunc` extension.
- **NULL comparisons.** `shipped_date > required_date` is NULL for unshipped orders, so they are in neither `late` nor `on_time`. Handle them explicitly, as in the example.
- **Fan-out before pivoting.** Joining `order_details` multiplies orders by lines. Use `COUNT(DISTINCT o.order_id) FILTER (...)` when counting orders after such a join.

## When to use it vs alternatives

| Need | Approach |
|---|---|
| Fixed set of columns, any database | `SUM(CASE WHEN ...)` |
| Fixed set of columns, PostgreSQL | `FILTER (WHERE ...)`: shorter, clearer |
| Unknown or many columns | `crosstab()` or pivot in the reporting tool |
| One value per group, not columns | Plain `GROUP BY` with the category as a row |
| Columns to rows (unpivot) | `UNION ALL` or `CROSS JOIN LATERAL (VALUES ...)`; see [UNION vs UNION ALL](/concepts/union-vs-union-all) |

Conditional aggregation is also the cleanest way to compare two periods; see [year-over-year growth](/concepts/year-over-year-growth).

## Interview questions

### How do you pivot rows to columns in SQL without a PIVOT function?
Group by the row key and write one aggregate per output column with a condition inside: `SUM(CASE WHEN year = 1997 THEN revenue ELSE 0 END) AS rev_1997`. In PostgreSQL you can write `SUM(revenue) FILTER (WHERE year = 1997)`.

### What is the difference between FILTER and CASE WHEN inside an aggregate?
They give the same result. `FILTER` is standard SQL supported by PostgreSQL and is easier to read; `CASE` works in nearly every database, including those without `FILTER`.

### Why does COUNT(CASE WHEN ... THEN 1 ELSE 0 END) give the wrong answer?
`COUNT` counts every non-NULL value, and 0 is not NULL, so every row is counted. Drop the `ELSE` so non-matching rows become NULL, or switch to `SUM`.

### How do you count several statuses in one query?
Use one conditional aggregate per status in the same `SELECT`, grouped by the entity. This scans the table once and keeps the statuses aligned on one row per entity.

## Practice

Practice this pattern with the questions below.
