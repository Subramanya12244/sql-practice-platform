---
title: GROUP BY
slug: group-by
category: aggregations
difficulty: Beginner
description: How SQL GROUP BY collapses rows into groups, the select-list rule, grouping by expressions, NULL groups, and ROLLUP and GROUPING SETS in PostgreSQL.
prerequisites: [count, sum]
related: [having, count, sum, conditional-aggregation, partition-by, distinct]
questions: [1, 2, 4, 10, 110, 129]
patterns: [find-duplicates, pivot-report]
guides: [group-by-having, sql-order-of-execution]
minutes: 9
version: 1
---

## Introduction

`GROUP BY` turns many rows into one row per group, so aggregates like `SUM` and `COUNT` can be computed per customer, category or month.

## Definition

`GROUP BY` partitions the rows that pass `WHERE` into groups with equal values of the grouping expressions. Each group returns one output row.

## Why it matters

Almost every reporting question is "metric per something". Interviewers also test the select-list rule and the difference between `WHERE` and `HAVING`.

## How it works

Logical order: `FROM` and joins, then `WHERE`, then `GROUP BY`, then aggregates, then `HAVING`, then `SELECT`, then `ORDER BY` and `LIMIT`. Every selected column must be either in `GROUP BY` or inside an aggregate. All NULLs in a grouping column form one group.

## Syntax

```sql-syntax
SELECT group_col1, group_col2, AGG(expr)
FROM table_name
WHERE row_condition
GROUP BY group_col1, group_col2
HAVING group_condition
ORDER BY ...;
```

## Simple examples

Products per category:

```sql
SELECT category_id, COUNT(*) AS products
FROM products
GROUP BY category_id
ORDER BY category_id;
```

Orders per employee, including the NULL-employee group:

```sql
SELECT employee_id, COUNT(*) AS orders
FROM orders
GROUP BY employee_id
ORDER BY employee_id NULLS FIRST;
```

## Intermediate examples

Group by an expression: orders per year and month.

```sql
SELECT EXTRACT(YEAR FROM order_date)::int  AS yr,
       EXTRACT(MONTH FROM order_date)::int AS mon,
       COUNT(*) AS orders
FROM orders
GROUP BY yr, mon
ORDER BY yr, mon
LIMIT 6;
```

Top 5 employees by revenue, grouping by several columns:

```sql
SELECT e.employee_id, e.first_name, e.last_name,
       ROUND(SUM(od.unit_price * od.quantity * (1 - od.discount))::numeric, 2) AS revenue
FROM employees e
JOIN orders o         ON o.employee_id = e.employee_id
JOIN order_details od ON od.order_id = o.order_id
GROUP BY e.employee_id, e.first_name, e.last_name
ORDER BY revenue DESC
LIMIT 5;
```

## Advanced examples

Group by a `CASE` bucket:

```sql
SELECT CASE WHEN unit_price < 20 THEN 'low'
            WHEN unit_price < 50 THEN 'mid'
            ELSE 'high' END AS band,
       COUNT(*) AS products,
       ROUND(AVG(unit_price), 2) AS avg_price
FROM products
GROUP BY band
ORDER BY MIN(unit_price);
```

Subtotals and a grand total with `ROLLUP`. `GROUPING()` marks the rows that are totals.

```sql
SELECT EXTRACT(YEAR FROM order_date)::int AS yr,
       ship_via,
       COUNT(*) AS orders,
       GROUPING(EXTRACT(YEAR FROM order_date)::int, ship_via) AS level
FROM orders
GROUP BY ROLLUP (EXTRACT(YEAR FROM order_date)::int, ship_via)
ORDER BY yr NULLS LAST, ship_via NULLS LAST;
```

Grouping by a primary key lets you select other columns of that table (functional dependency):

```sql
SELECT c.customer_id, c.company_name, c.country, COUNT(o.order_id) AS orders
FROM customers c
LEFT JOIN orders o ON o.customer_id = c.customer_id
GROUP BY c.customer_id
ORDER BY orders DESC, c.customer_id
LIMIT 5;
```

## Real-world scenarios

- Monthly revenue trend: group by `DATE_TRUNC('month', order_date)`.
- Duplicate check: group by the natural key, keep `COUNT(*) > 1`.
- Segment summaries: group by a `CASE` band.
- Finance reports with subtotals: `ROLLUP` or `GROUPING SETS`.

## PostgreSQL specifics

- PostgreSQL lets `GROUP BY` reference output aliases and positions (`GROUP BY 1`). Standard SQL does not allow aliases there.
- In PostgreSQL, grouping by a table's primary key allows selecting any column of that table.
- `ROLLUP`, `CUBE` and `GROUPING SETS` are supported, with `GROUPING()` to identify total rows.
- Unlike older MySQL, PostgreSQL rejects non-grouped, non-aggregated columns with an error.

## Visual explanation

```text
orders                         GROUP BY ship_via
order_id | ship_via            ship_via | COUNT(*)
10248    | 3          ──┐      1        | n1
10249    | 1            ├──►   2        | n2
10250    | 2            │      3        | n3
10251    | 1          ──┘
```

## Common mistakes

- Selecting a column that is neither grouped nor aggregated.
- Filtering aggregates in `WHERE` instead of `HAVING`.
- Grouping by a name instead of the ID, which merges different entities with the same name.
- Expecting `GROUP BY` to sort; add `ORDER BY`.

## Performance

- PostgreSQL uses HashAggregate or sort-based GroupAggregate; an index on the grouping columns can enable the sorted plan.
- Filter in `WHERE` before grouping so fewer rows are aggregated.
- Aggregate detail rows before joining to dimension tables when the join only adds labels.

## Interview questions

### What is the rule for columns in the SELECT list with GROUP BY?

Each must be in `GROUP BY`, inside an aggregate, or functionally dependent on a grouped primary key.

### What is the difference between WHERE and HAVING?

`WHERE` filters rows before grouping. `HAVING` filters groups after aggregation.

### How are NULLs grouped?

All NULLs in the grouping column fall into one group.

### What does ROLLUP do?

It adds subtotal rows for each prefix of the grouping list plus a grand total.

### Is GROUP BY output sorted?

No. Order is not guaranteed without `ORDER BY`.

## Quick revision

- One output row per distinct grouping key.
- Non-aggregated columns must be grouped.
- `WHERE` before grouping, `HAVING` after.
- NULLs form a single group.
- Group by IDs, not just names.
- `ROLLUP`/`GROUPING SETS` give subtotals.
- Add `ORDER BY`; grouping does not sort.
