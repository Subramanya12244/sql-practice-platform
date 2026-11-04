---
title: Pivot report
slug: pivot-report
category: reshape
difficulty: Intermediate
description: Turn rows into columns (categories by year, countries by quarter) with SUM … FILTER or CASE; PostgreSQL has no PIVOT keyword.
questions: [131, 111, 130]
notes: [conditional-aggregation, filter-clause, case, date-time-functions]
guides: [pivot-rows-to-columns, conditional-aggregation-pivot]
---

## Problem

Show one row per entity and one column per value of another dimension, for example category revenue with a column per year.

## When to use it

- Spreadsheet-style reports.
- Comparing periods side by side.
- Building a matrix of counts (country by shipper).

## Solution

PostgreSQL has no `PIVOT` keyword (SQL Server and Oracle do). Use conditional aggregation, one expression per output column:

```sql
WITH lines AS (
  SELECT c.category_name,
         EXTRACT(YEAR FROM o.order_date)::int AS year,
         od.unit_price * od.quantity * (1 - od.discount) AS revenue
  FROM order_details od
  JOIN orders o     ON o.order_id = od.order_id
  JOIN products p   ON p.product_id = od.product_id
  JOIN categories c ON c.category_id = p.category_id
),
latest AS (SELECT MAX(year) AS y FROM lines)
SELECT l.category_name,
       ROUND(SUM(revenue) FILTER (WHERE year = y - 1)::numeric, 2) AS previous_year,
       ROUND(SUM(revenue) FILTER (WHERE year = y)::numeric, 2)     AS latest_year,
       ROUND(SUM(revenue)::numeric, 2)                             AS all_years
FROM lines l CROSS JOIN latest
GROUP BY l.category_name
ORDER BY l.category_name;
```

Pivot columns are fixed when the query is written. Here they are defined relative to the latest year in the data, so the query works whatever years the orders cover. In a real report you would usually write literal years (`WHERE year = 2025`).

## Alternatives

Columns by quarter (order counts per shipping country):

```sql
SELECT ship_country,
       COUNT(*) FILTER (WHERE EXTRACT(QUARTER FROM order_date) = 1) AS q1,
       COUNT(*) FILTER (WHERE EXTRACT(QUARTER FROM order_date) = 2) AS q2,
       COUNT(*) FILTER (WHERE EXTRACT(QUARTER FROM order_date) = 3) AS q3,
       COUNT(*) FILTER (WHERE EXTRACT(QUARTER FROM order_date) = 4) AS q4,
       COUNT(*) AS total
FROM orders
GROUP BY ship_country
ORDER BY total DESC;
```

Portable `CASE` form (country by shipper):

```sql
SELECT ship_country,
       SUM(CASE WHEN ship_via = 1 THEN 1 ELSE 0 END) AS shipper_1,
       SUM(CASE WHEN ship_via = 2 THEN 1 ELSE 0 END) AS shipper_2,
       SUM(CASE WHEN ship_via = 3 THEN 1 ELSE 0 END) AS shipper_3
FROM orders
GROUP BY ship_country
ORDER BY ship_country;
```

For dynamic columns, build the SQL in application code, or use `crosstab()` from the `tablefunc` extension. You can also return JSON with `jsonb_object_agg(key, value)`, which needs no fixed columns.

## How it works

`GROUP BY` sets the rows. Each conditional aggregate sets one column: it only aggregates the rows whose pivot value matches that column. Cells with no rows are NULL for `SUM` and 0 for `COUNT`. Wrap `SUM` in `COALESCE(…, 0)` to show zeros.

## Execution walkthrough

1. The joins attach category and order date to every order line.
2. `GROUP BY category_name` forms one group per category.
3. For each line, only the `FILTER` whose year matches adds its revenue.
4. Each group yields one row with one total per year.

## Common mistakes

- Grouping by the pivot column too (`GROUP BY category_name, year`). That gives one row per pair, which is not a pivot.
- Forgetting that a missing cell is NULL, not 0.
- Hard-coding values that do not exist in the data, which gives an all-NULL column.

## Performance

One scan and one hash aggregate, whatever the number of columns. Each extra column only adds a condition check per row.
