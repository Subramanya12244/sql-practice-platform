---
title: SQL Cheat Sheet for Interviews (PostgreSQL)
description: One-page PostgreSQL SQL cheat sheet for interviews: query execution order, joins, GROUP BY and HAVING, CTEs, window ranking, set operators, and NULL rules.
keywords: sql cheat sheet, sql interview cheat sheet, postgresql cheat sheet, sql joins cheat sheet, window functions cheat sheet
---

A dense reference for SQL interviews, using the Northwind schema. Revenue is always `unit_price * quantity * (1 - discount)` from `order_details`.

## Logical order of execution

| Step | Clause | Notes |
|---|---|---|
| 1 | `FROM` / `JOIN` | Build the row set |
| 2 | `WHERE` | Filter rows; no aggregates, no `SELECT` aliases |
| 3 | `GROUP BY` | Set the grain |
| 4 | `HAVING` | Filter groups; aggregates allowed |
| 5 | `SELECT` | Compute columns, window functions, aliases |
| 6 | `DISTINCT` | Remove duplicate output rows |
| 7 | `ORDER BY` | Aliases allowed |
| 8 | `LIMIT` / `OFFSET` | Always pair with `ORDER BY` |

Window functions run at step 5, so you cannot filter them in `WHERE`; wrap them in a CTE.

## Joins

| Join | Keeps | Typical use |
|---|---|---|
| `INNER JOIN` | Matching rows only | Revenue by category |
| `LEFT JOIN` | All left + matches (NULL if none) | All customers, zero included |
| `RIGHT JOIN` | All right + matches | Same as LEFT with tables swapped |
| `FULL OUTER JOIN` | All rows from both sides | Reconcile two datasets |
| `CROSS JOIN` | Every pair (rows A × rows B) | Combination scaffolds |
| Self join | Same table, two aliases | Manager hierarchy, pairs |

```sql
-- Filter the optional side in ON, not WHERE, to keep the outer join
SELECT c.customer_id, COUNT(o.order_id) AS orders_1998
FROM customers c
LEFT JOIN orders o
  ON o.customer_id = c.customer_id
 AND o.order_date >= DATE '1998-01-01'
GROUP BY c.customer_id;
```

- Chained outer joins: every downstream link must stay `LEFT`.
- `RIGHT JOIN` chains preserve the **last** right-hand table.
- One-to-many joins fan out rows; count with `COUNT(DISTINCT key)`.

## Aggregates, GROUP BY, HAVING

```sql
SELECT p.category_id,
       COUNT(DISTINCT od.order_id) AS orders,
       SUM(od.unit_price * od.quantity * (1 - od.discount)) AS revenue
FROM products p
JOIN order_details od ON od.product_id = p.product_id
WHERE p.discontinued = false          -- row filter
GROUP BY p.category_id
HAVING SUM(od.quantity) > 1000        -- group filter
ORDER BY revenue DESC;
```

- Every selected column is grouped or aggregated (grouping by a PK allows its dependent columns).
- Aggregates ignore NULLs; `SUM`/`AVG` of nothing is NULL, `COUNT` of nothing is 0.
- No nesting: `AVG(SUM(x))` fails. Aggregate in a CTE, then aggregate again.
- Average order value: total per order first, then `AVG`.
- Cast before rounding double precision: `ROUND(x::numeric, 2)`.

## Subquery vs CTE

| | Subquery | CTE (`WITH`) |
|---|---|---|
| Placement | Inline | Top of statement |
| Reuse in same query | No | Yes |
| Recursion | No | `WITH RECURSIVE` |
| Correlated per row | Yes | No (join it instead) |
| PostgreSQL 12+ perf | Same | Inlined unless referenced twice or `MATERIALIZED` |

```sql
-- Above-average pattern
WITH cust AS (
    SELECT o.customer_id,
           SUM(od.unit_price * od.quantity * (1 - od.discount)) AS revenue
    FROM orders o JOIN order_details od ON od.order_id = o.order_id
    GROUP BY o.customer_id
)
SELECT * FROM cust
WHERE revenue > (SELECT AVG(revenue) FROM cust);
```

## Window ranking

| Function | Ties | Gaps | Values for 100, 90, 90, 80 |
|---|---|---|---|
| `ROW_NUMBER()` | Broken arbitrarily | — | 1, 2, 3, 4 |
| `RANK()` | Same rank | Yes | 1, 2, 2, 4 |
| `DENSE_RANK()` | Same rank | No | 1, 2, 2, 3 |

```sql
RANK() OVER (PARTITION BY category_id ORDER BY revenue DESC)
```

Use `ROW_NUMBER` for exactly N rows, `RANK`/`DENSE_RANK` when ties must be kept.

## Top-N per group

```sql
WITH product_rev AS (
    SELECT p.category_id, p.product_name,
           SUM(od.unit_price * od.quantity * (1 - od.discount)) AS revenue
    FROM products p
    JOIN order_details od ON od.product_id = p.product_id
    GROUP BY p.category_id, p.product_id, p.product_name
),
ranked AS (
    SELECT *, RANK() OVER (PARTITION BY category_id ORDER BY revenue DESC) AS rnk
    FROM product_rev
)
SELECT category_id, product_name, revenue
FROM ranked
WHERE rnk <= 3
ORDER BY category_id, rnk;
```

`LIMIT` alone gives top N overall, not per group, and drops ties.

## Anti-join (rows with no match)

```sql
-- Preferred: NULL-safe
SELECT p.product_id, p.product_name
FROM products p
WHERE NOT EXISTS (SELECT 1 FROM order_details od WHERE od.product_id = p.product_id);

-- Equivalent
SELECT p.product_id, p.product_name
FROM products p
LEFT JOIN order_details od ON od.product_id = p.product_id
WHERE od.product_id IS NULL;
```

Avoid `NOT IN (subquery)` when the subquery column can be NULL.

## Self-join pair pattern

```sql
SELECT c1.customer_id, c2.customer_id, c1.city
FROM customers c1
JOIN customers c2
  ON c1.city = c2.city                 -- shared value (required)
 AND c1.customer_id < c2.customer_id;  -- each pair once, no self-pairs
```

Hierarchy: `LEFT JOIN employees m ON m.employee_id = e.reports_to` keeps the top manager.

## Set operators

| Operator | Returns | Duplicates |
|---|---|---|
| `UNION ALL` | All rows | Kept (fastest) |
| `UNION` | Distinct rows from all | Removed |
| `INTERSECT` | Rows in both | Removed (`ALL` keeps) |
| `EXCEPT` | Rows in first, not second | Removed (`ALL` keeps) |

- Same column count, compatible types, matched by position.
- Column names come from the first `SELECT`.
- One `ORDER BY` at the end sorts the whole result.
- Set operators treat NULLs as equal.
- Keep literal labels consistent: `'Customer'`, `'Supplier'`, `'Employee'` (case-sensitive).
- Use `UNION ALL` inside CTEs that feed counts.

## NULL rules

| Rule | Detail |
|---|---|
| `COUNT(*)` vs `COUNT(col)` | Rows vs non-NULL values; over a LEFT JOIN count the right PK to get 0 |
| Test | `IS NULL` / `IS NOT NULL`, never `= NULL` |
| `COALESCE(a, b, ...)` | First non-NULL; `COALESCE(SUM(x), 0)` |
| `NULLIF(a, b)` | NULL when equal; safe division `x / NULLIF(y, 0)` |
| `NOT IN` trap | Any NULL in the list makes it return no rows |
| `\|\|` vs `CONCAT` | `'a' \|\| NULL` is NULL; `CONCAT('a', NULL)` is `'a'`; `CONCAT(NULL, ' ', NULL)` is `' '` |
| Sorting | NULLs last in `ASC`, first in `DESC`; override with `NULLS LAST` / `NULLS FIRST` |
| Comparing | `a IS NOT DISTINCT FROM b` treats NULLs as equal |

```sql
SELECT c.customer_id,
       MAX(o.order_date) AS last_order,
       COUNT(o.order_id) AS orders
FROM customers c
LEFT JOIN orders o ON o.customer_id = c.customer_id
GROUP BY c.customer_id
ORDER BY last_order DESC NULLS LAST;
```
