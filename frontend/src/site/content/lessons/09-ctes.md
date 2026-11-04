---
title: SQL CTEs and Recursive Queries
slug: ctes
order: 9
level: Intermediate
description: Write readable SQL with CTEs (WITH clause), chain multiple CTEs, and walk hierarchies with WITH RECURSIVE on the Northwind employee tree.
related: [q19-customers-above-average-revenue-using-cte, q20-top-5-customers-by-revenue-using-cte, q21-employees-above-average-revenue-using-multiple-ctes, q22-top-employee-by-revenue-using-3-ctes]
---

A common table expression (CTE) names a temporary result set with `WITH` so the main query can use it like a table. CTEs make multi-step logic readable. `WITH RECURSIVE` lets a CTE reference itself, which is how SQL walks trees and generates series.

## Syntax

```sql
WITH a AS (SELECT ...),
     b AS (SELECT ... FROM a)
SELECT ... FROM b;

WITH RECURSIVE tree AS (
    SELECT ...            -- anchor: starting rows
    UNION ALL
    SELECT ... FROM t JOIN tree ON ...   -- recursive step
)
SELECT ... FROM tree;
```

## Examples

**Revenue per customer, then filter above average:**

```sql
WITH customer_revenue AS (
    SELECT o.customer_id, SUM(od.unit_price * od.quantity * (1 - od.discount)) AS revenue
    FROM orders o
    JOIN order_details od ON od.order_id = o.order_id
    GROUP BY o.customer_id
)
SELECT customer_id, ROUND(revenue::numeric, 2) AS revenue
FROM customer_revenue
WHERE revenue > (SELECT AVG(revenue) FROM customer_revenue);
```

**Recursive: the reporting chain with depth:**

```sql
WITH RECURSIVE chain AS (
    SELECT employee_id, last_name, reports_to, 1 AS depth
    FROM employees
    WHERE reports_to IS NULL
    UNION ALL
    SELECT e.employee_id, e.last_name, e.reports_to, c.depth + 1
    FROM employees e
    JOIN chain c ON e.reports_to = c.employee_id
)
SELECT * FROM chain ORDER BY depth, employee_id;
```

**Recursive number series:**

```sql
WITH RECURSIVE n AS (
    SELECT 1 AS i
    UNION ALL
    SELECT i + 1 FROM n WHERE i < 12
)
SELECT i AS month FROM n;
```

## Common mistakes

- Writing `WITH` twice. Separate CTEs with commas under one `WITH`.
- A recursive CTE with no stopping condition loops until it errors or runs out of memory.
- Using `UNION` instead of `UNION ALL` in recursion when you need duplicates; `UNION` also adds dedupe cost.

## Exercises

```exercise
prompt: Using a CTE, compute the number of orders per employee and return employee_id and order_count only for employees with more than 10 orders.
---
WITH emp_orders AS (SELECT employee_id, COUNT(*) AS order_count FROM orders GROUP BY employee_id) SELECT employee_id, order_count FROM emp_orders WHERE order_count > 10;
```

```exercise
prompt: Using WITH RECURSIVE, list every employee with their depth in the reporting tree (top manager = 1). Return employee_id, last_name, depth.
orderBy: depth, employee_id
---
WITH RECURSIVE chain AS (SELECT employee_id, last_name, 1 AS depth FROM employees WHERE reports_to IS NULL UNION ALL SELECT e.employee_id, e.last_name, c.depth + 1 FROM employees e JOIN chain c ON e.reports_to = c.employee_id) SELECT employee_id, last_name, depth FROM chain ORDER BY depth, employee_id;
```

```exercise
prompt: Use a recursive CTE to generate the numbers 1 through 10 in a column named n.
orderBy: n
---
WITH RECURSIVE s AS (SELECT 1 AS n UNION ALL SELECT n + 1 FROM s WHERE n < 10) SELECT n FROM s ORDER BY n;
```
