---
slug: full-outer-join
title: SQL FULL OUTER JOIN Explained with Examples
description: Learn SQL FULL OUTER JOIN with Northwind examples: keep unmatched rows from both tables, reconcile datasets, handle NULLs with COALESCE, and avoid traps.
keywords: sql full outer join, full join, full outer join example, full outer join vs union, data reconciliation sql
questions: 51, 52, 53, 54, 55, 56, 57, 58
related: left-join, right-join, null-handling-coalesce
---

A `FULL OUTER JOIN` returns all rows from both tables. Matching rows are combined; a row without a partner on the other side still appears, with NULLs in the other table's columns. It is the union of a `LEFT JOIN` and a `RIGHT JOIN` on the same condition, and it is the standard tool for reconciling two datasets.

## Syntax

```sql
SELECT COALESCE(a.key, b.key) AS key, a.col, b.col
FROM table_a a
FULL [OUTER] JOIN table_b b
  ON b.key = a.key;
```

## Example

**Business question:** Show every employee with their total orders, and also any orders with no assigned employee.

```sql
SELECT e.employee_id,
       e.first_name || ' ' || e.last_name AS employee_name,
       COUNT(o.order_id) AS total_orders
FROM employees e
FULL OUTER JOIN orders o ON o.employee_id = e.employee_id
GROUP BY e.employee_id, e.first_name, e.last_name
ORDER BY total_orders DESC;
```

Illustrative result:

| employee_id | employee_name | total_orders |
|---|---|---|
| 6 | Michael Suyama | 22 |
| 4 | Margaret Peacock | 11 |
| 8 | Laura Callahan | 11 |
| *NULL* | *NULL* | 1 |

In this data one order has a NULL `employee_id`, so it lands in the NULL group, and Steven Buchanan (employee 5) appears with 0 orders. The query is still correct: it is built to surface data-quality gaps on either side.

## How it works

The result has three kinds of rows:

1. **Matched:** both sides filled.
2. **Left-only:** right-side columns NULL (an employee with no orders).
3. **Right-only:** left-side columns NULL (an order with no matching employee).

Because either side can be NULL, two habits matter:

- **Merge keys with `COALESCE`.** `COALESCE(a.customer_id, b.customer_id)` gives one non-null key for every row.
- **Label the match status** with `CASE`.

A reconciliation example compares 1997 and 1998 revenue per customer, keeping customers active in only one year:

```sql
WITH y1997 AS (
    SELECT o.customer_id, SUM(od.unit_price * od.quantity * (1 - od.discount)) AS rev
    FROM orders o JOIN order_details od ON od.order_id = o.order_id
    WHERE o.order_date >= DATE '1997-01-01' AND o.order_date < DATE '1998-01-01'
    GROUP BY o.customer_id
),
y1998 AS (
    SELECT o.customer_id, SUM(od.unit_price * od.quantity * (1 - od.discount)) AS rev
    FROM orders o JOIN order_details od ON od.order_id = o.order_id
    WHERE o.order_date >= DATE '1998-01-01' AND o.order_date < DATE '1999-01-01'
    GROUP BY o.customer_id
)
SELECT COALESCE(a.customer_id, b.customer_id) AS customer_id,
       ROUND(COALESCE(a.rev, 0)::numeric, 2) AS rev_1997,
       ROUND(COALESCE(b.rev, 0)::numeric, 2) AS rev_1998,
       CASE WHEN a.customer_id IS NULL THEN 'New in 1998'
            WHEN b.customer_id IS NULL THEN 'Lost in 1998'
            ELSE 'Both years' END AS status
FROM y1997 a
FULL OUTER JOIN y1998 b ON b.customer_id = a.customer_id
ORDER BY status, customer_id;
```

## Common mistakes

- **Selecting the key from one side only.** `SELECT a.customer_id` shows NULL for right-only rows. Use `COALESCE(a.key, b.key)`.
- **Filtering in `WHERE`.** A condition on either table's column removes the NULL-padded rows and silently degrades the join. Filter inside CTEs before joining, or in `ON`.
- **`||` vs `CONCAT` on missing names.** A recorded mistake on this site (Q57): `CONCAT(e.first_name, ' ', e.last_name)` returned `' '` (a single space) for the unmatched row, while the spec required NULL. `||` propagates NULL; `CONCAT` treats NULL as an empty string.
- **Fan-out before the full join.** Joining raw detail tables on both sides multiplies rows. Aggregate each side to the key's grain first, as in the CTE example.
- **Expecting MySQL support.** MySQL has no `FULL OUTER JOIN`; it is emulated with `LEFT JOIN ... UNION ... RIGHT JOIN`. PostgreSQL supports it natively.

## When to use it vs alternatives

| Need | Use |
|---|---|
| All rows of A, optional B | `LEFT JOIN` |
| All rows of both, side by side | `FULL OUTER JOIN` |
| Stack rows from both, same columns | `UNION ALL` |
| Keys in A but not B | `EXCEPT` or anti join |
| Keys in both | `INTERSECT` or `INNER JOIN` |

`FULL OUTER JOIN` puts the two sources in separate columns, which suits comparisons. `UNION` stacks them in the same columns, which suits directories.

## Interview questions

### What does a FULL OUTER JOIN return?
It returns every row from both tables. Matching rows are combined into one, and rows without a match appear once with NULLs in the other table's columns. Its row count is at least the larger of the two tables' counts when joining on a unique key.

### How is FULL OUTER JOIN different from UNION?
A full outer join places matching rows from the two tables side by side in one wider row. `UNION` stacks rows vertically and requires the same number and types of columns. Use the join to compare sources and `UNION` to combine lists.

### How do you identify which side a row came from in a FULL OUTER JOIN?
Check the join keys: if the left key is NULL, the row is right-only; if the right key is NULL, it is left-only; if both are present, it matched. A `CASE` expression on those checks makes a clear status column.

### How do you emulate FULL OUTER JOIN in a database that lacks it?
Combine a `LEFT JOIN` with the unmatched rows of a `RIGHT JOIN` using `UNION ALL` (filtering the second part to left-key IS NULL), or use `UNION` of a left and right join. PostgreSQL does not need this because it supports full joins directly.

## Practice

Practice this pattern with the questions below.
