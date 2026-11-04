---
slug: sql-order-of-execution
title: SQL Order of Execution (Logical Query Processing)
description: Learn the SQL order of execution: FROM, WHERE, GROUP BY, HAVING, SELECT, window functions, ORDER BY, LIMIT, and why aliases and aggregates fail in WHERE.
keywords: sql order of execution, sql query execution order, logical query processing, why can't i use alias in where, where vs having, order of operations sql
questions: 6, 8, 15, 19, 100, 105
related: group-by-having, window-functions, aggregate-functions, cte, left-join
---

SQL is written starting with `SELECT`, but it is logically evaluated starting with `FROM`. Knowing this order explains the most common interview errors: why an alias from `SELECT` cannot be used in `WHERE`, why aggregates need `HAVING`, and why window functions must be filtered in an outer query. The database may physically execute things differently, but the result must match this logical order.

## Syntax

The logical order, step by step:

```sql
-- 1. FROM / JOIN ... ON     build the working row set
-- 2. WHERE                  filter individual rows
-- 3. GROUP BY               form groups
-- 4. HAVING                 filter groups
-- 5. SELECT                 compute expressions and aliases
-- 6. window functions       OVER (...) computed on the grouped rows
-- 7. DISTINCT               remove duplicate output rows
-- 8. UNION / INTERSECT / EXCEPT
-- 9. ORDER BY               sort (can use SELECT aliases)
-- 10. LIMIT / OFFSET        keep a slice
```

## Example

**Business question:** Which customer countries placed at least 3 orders in 1997? Show the top countries.

```sql
SELECT c.country,
       COUNT(DISTINCT o.order_id) AS orders_1997
FROM customers c
JOIN orders o ON o.customer_id = c.customer_id
WHERE o.order_date >= DATE '1997-01-01'
  AND o.order_date <  DATE '1998-01-01'
GROUP BY c.country
HAVING COUNT(DISTINCT o.order_id) >= 3
ORDER BY orders_1997 DESC, c.country
LIMIT 5;
```

Result:

| country | orders_1997 |
|---|---|
| France | 5 |
| Germany | 5 |
| USA | 5 |
| UK | 4 |

Reading it in execution order:

1. **FROM / JOIN** pairs every order with its customer.
2. **WHERE** keeps only 1997 orders. This runs before grouping, so it cannot mention `COUNT`.
3. **GROUP BY** creates one group per country.
4. **HAVING** drops countries with fewer than 3 orders. It must repeat the aggregate, because the alias `orders_1997` does not exist yet.
5. **SELECT** computes `orders_1997`.
6. **ORDER BY** can use the alias, because it runs after `SELECT`.
7. **LIMIT** keeps at most 5 rows; only 4 countries qualified.

## How it works

Each step only sees what earlier steps produced:

- **Aliases** are created in `SELECT` (step 5). `WHERE`, `GROUP BY` and `HAVING` run earlier, so standard SQL rejects aliases there. PostgreSQL is lenient in `GROUP BY` (it accepts output column names), but not in `WHERE` or `HAVING`.
- **Aggregates** are computed on groups (steps 3–4), so they are legal in `HAVING`, `SELECT` and `ORDER BY` but not in `WHERE`.
- **Window functions** run after `HAVING` (step 6). To filter by `ROW_NUMBER()` or `RANK()`, wrap the query in a CTE or subquery and filter in the outer `WHERE`. See [top N per group](/concepts/top-n-per-group).
- **`ON` vs `WHERE` in outer joins.** `ON` is part of building the row set; `WHERE` filters afterwards. That is why a `WHERE` on the right table turns a [LEFT JOIN](/concepts/left-join) into an inner join.
- **`LIMIT` is last**, so it applies to the sorted final result, not per group.

```sql
-- Filtering on a window result requires an outer query
WITH ranked AS (
    SELECT product_name, unit_price,
           RANK() OVER (ORDER BY unit_price DESC) AS rnk
    FROM products
)
SELECT product_name, unit_price
FROM ranked
WHERE rnk <= 3;
```

## Common mistakes

- **Alias in `WHERE`.** `SELECT unit_price * 2 AS doubled ... WHERE doubled > 50` fails. Repeat the expression or use a subquery.
- **Aggregate in `WHERE`.** `WHERE COUNT(*) > 3` is an error. Move it to `HAVING`.
- **Row filters in `HAVING`.** `HAVING country = 'USA'` works but runs after grouping every country. Put row conditions in `WHERE` so less data is grouped.
- **Window function in `WHERE`.** Use an outer query.
- **Expecting `LIMIT` to apply before `ORDER BY`.** It always takes the first rows after sorting.
- **`DISTINCT` and `ORDER BY`.** With `SELECT DISTINCT`, `ORDER BY` expressions must appear in the select list, because sorting happens after duplicates are removed.

## When to use it vs alternatives

Use the order as a debugging checklist. When a query errors on an unknown column or misplaced aggregate, ask which step the clause runs in and whether that value exists yet. If you need a later-step value in an earlier clause, add a layer: a [CTE](/concepts/cte) or subquery turns step 5–6 output into the next query's step 1 input. For "filter rows vs filter groups", see [GROUP BY and HAVING](/concepts/group-by-having).

## Interview questions

### What is the logical order of execution of a SQL query?
`FROM` and joins, `WHERE`, `GROUP BY`, `HAVING`, `SELECT` (including window functions), `DISTINCT`, set operators, `ORDER BY`, then `LIMIT`/`OFFSET`. The engine may optimise physically, but results follow this order.

### Why can't you use a column alias in the WHERE clause?
The alias is defined in `SELECT`, which is evaluated after `WHERE`. When `WHERE` runs, the alias does not exist yet. Repeat the expression or compute it in a subquery or CTE.

### What is the difference between WHERE and HAVING?
`WHERE` filters individual rows before grouping and cannot use aggregates. `HAVING` filters groups after `GROUP BY` and can use aggregates like `COUNT(*)` or `SUM(...)`.

### Why can you use an alias in ORDER BY but not in WHERE?
`ORDER BY` runs after `SELECT`, so the alias already exists. `WHERE` runs before `SELECT`.

### When are window functions evaluated?
After `WHERE`, `GROUP BY` and `HAVING`, at the `SELECT` stage and before `ORDER BY`. That is why they can rank aggregated groups but cannot be referenced in `WHERE` or `HAVING` of the same query.

## Practice

Practice this pattern with the questions below.
