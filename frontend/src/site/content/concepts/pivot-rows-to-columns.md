---
slug: pivot-rows-to-columns
title: SQL Pivot Rows to Columns with FILTER, CASE and crosstab
description: Pivot rows into columns in SQL with SUM FILTER, SUM(CASE WHEN) and PostgreSQL crosstab, using Northwind revenue by year and orders by shipper examples.
keywords: sql pivot rows to columns, pivot in postgresql, sum case when pivot, filter clause sql, crosstab postgresql, conditional aggregation
questions: 131, 130, 92, 93, 86
related: conditional-aggregation-pivot, group-by-having, aggregate-functions, cte
---

Pivoting turns values that live in rows (years, statuses, shippers) into separate columns, so one row per entity holds a side-by-side comparison. PostgreSQL has no `PIVOT` keyword. The portable answer is conditional aggregation: one aggregate per output column, each restricted to the rows that belong in it with `FILTER (WHERE ...)` or `CASE WHEN`.

## Syntax

```sql
SELECT row_key,
       SUM(metric) FILTER (WHERE pivot_col = 'A') AS a,
       SUM(metric) FILTER (WHERE pivot_col = 'B') AS b
FROM t
GROUP BY row_key;

-- Portable form
SELECT row_key,
       SUM(CASE WHEN pivot_col = 'A' THEN metric END) AS a,
       SUM(CASE WHEN pivot_col = 'B' THEN metric END) AS b
FROM t
GROUP BY row_key;
```

## Example

**Business question:** Show revenue per category with one column per year.

```sql
SELECT c.category_name,
       ROUND(SUM(od.unit_price * od.quantity * (1 - od.discount))
             FILTER (WHERE EXTRACT(YEAR FROM o.order_date) = 1996)::numeric, 2) AS y1996,
       ROUND(SUM(od.unit_price * od.quantity * (1 - od.discount))
             FILTER (WHERE EXTRACT(YEAR FROM o.order_date) = 1997)::numeric, 2) AS y1997,
       ROUND(SUM(od.unit_price * od.quantity * (1 - od.discount))
             FILTER (WHERE EXTRACT(YEAR FROM o.order_date) = 1998)::numeric, 2) AS y1998
FROM order_details od
JOIN orders o     ON o.order_id    = od.order_id
JOIN products p   ON p.product_id  = od.product_id
JOIN categories c ON c.category_id = p.category_id
GROUP BY c.category_name
ORDER BY c.category_name;
```

| category_name | y1996 | y1997 | y1998 |
|---|---|---|---|
| Beverages | 11705.40 | 4772.42 | 12857.70 |
| Condiments | 6030.69 | 5794.68 | 3351.39 |
| Confections | 7799.85 | 5119.97 | 7592.03 |
| Dairy Products | 7423.72 | 6741.73 | 4164.32 |
| Grains/Cereals | 3416.74 | 1981.17 | 2442.51 |
| Meat/Poultry | 4976.17 | 6017.39 | 7711.72 |
| Produce | 4840.34 | 3755.46 | 3245.22 |
| Seafood | 6132.35 | 5875.95 | 4570.86 |

## How it works

1. `GROUP BY category_name` produces one output row per category.
2. Each `SUM ... FILTER` only sees the lines from its year, so the three columns are three independent totals over the same group.
3. Rows that match no filter contribute nothing; a category with no sales in a year would show `NULL`, which you can wrap in `COALESCE(..., 0)`.

**Counting instead of summing.** Pivot order counts by shipper for the busiest destination countries:

```sql
SELECT ship_country,
       COUNT(*) FILTER (WHERE ship_via = 1) AS shipper_1,
       COUNT(*) FILTER (WHERE ship_via = 2) AS shipper_2,
       COUNT(*) FILTER (WHERE ship_via = 3) AS shipper_3,
       COUNT(*) AS total
FROM orders
GROUP BY ship_country
ORDER BY total DESC
LIMIT 5;
```

| ship_country | shipper_1 | shipper_2 | shipper_3 | total |
|---|---|---|---|---|
| USA | 3 | 5 | 5 | 13 |
| France | 4 | 5 | 4 | 13 |
| Germany | 5 | 5 | 3 | 13 |
| Brazil | 5 | 1 | 3 | 9 |
| UK | 3 | 4 | 1 | 8 |

**`crosstab`** from the `tablefunc` extension can pivot dynamically shaped data, but it requires `CREATE EXTENSION tablefunc`, a fixed output column list, and carefully ordered input. In interviews, conditional aggregation is the expected answer.

## Common mistakes

- **Forgetting `GROUP BY`.** Without it you get one grand-total row.
- **Using `ELSE 0` with `AVG` or `COUNT`.** `COUNT(CASE WHEN ... THEN 1 ELSE 0 END)` counts every row, because 0 is not `NULL`. Leave out `ELSE` or use `SUM`.
- **Expecting dynamic columns.** SQL needs the output columns at parse time. A new year means editing the query or generating it in code.
- **Grouping by the pivot column too.** That puts the values back into rows.

## When to use it vs alternatives

| Approach | Portable | Dynamic columns | Notes |
|---|---|---|---|
| `SUM(...) FILTER (WHERE ...)` | PostgreSQL, SQLite | No | Cleanest syntax |
| `SUM(CASE WHEN ... END)` | Everywhere | No | Interview default |
| `crosstab()` | PostgreSQL only | Partly | Needs `tablefunc` |
| `PIVOT` keyword | SQL Server, Oracle, Snowflake | No | Not in PostgreSQL |

See [conditional aggregation](/concepts/conditional-aggregation-pivot) for more `FILTER` examples.

## Interview questions

### How do you pivot rows to columns in SQL?
Group by the row key and write one conditional aggregate per output column, for example `SUM(CASE WHEN year = 1997 THEN revenue END) AS y1997`. In PostgreSQL, `SUM(revenue) FILTER (WHERE year = 1997)` does the same thing more readably.

### Does PostgreSQL have a PIVOT function?
No. It has conditional aggregation with `FILTER` and the `crosstab` function from the `tablefunc` extension. SQL Server, Oracle and Snowflake have a `PIVOT` clause.

### How do you unpivot columns back into rows?
Use `UNION ALL` of one `SELECT` per column, or in PostgreSQL a `CROSS JOIN LATERAL (VALUES ('1996', y1996), ('1997', y1997)) v(year, revenue)`.

### What is the difference between FILTER and CASE WHEN?
They give the same result. `FILTER` is SQL-standard syntax supported by PostgreSQL and SQLite and reads more clearly; `CASE WHEN` inside the aggregate works in every database.

## Practice

Practice this pattern with the questions below.
