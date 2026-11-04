---
title: HAVING
slug: having
category: aggregations
difficulty: Beginner
description: Filter groups after aggregation with HAVING, and learn when to use WHERE instead. PostgreSQL examples on Northwind.
prerequisites: [group-by, where]
related: [count, sum, avg, conditional-aggregation, scalar-subqueries]
questions: [15, 16, 17, 62, 176]
patterns: [find-duplicates]
guides: [group-by-having]
minutes: 7
version: 1
---

## Introduction

`WHERE` filters rows. `HAVING` filters groups. If the condition uses an aggregate such as `COUNT(*)` or `SUM(...)`, it belongs in `HAVING`.

## Definition

`HAVING` is a filter applied after `GROUP BY` has formed groups and computed aggregates. It keeps only the groups where the condition is true.

## Why it matters

Questions like "customers with at least 2 orders" or "countries with at least 5 customers" are group-level filters. Interviewers often check whether you know `WHERE COUNT(*) > 3` is an error.

## How it works

Logical order: `FROM` → `WHERE` → `GROUP BY` → aggregates → `HAVING` → `SELECT` → `ORDER BY` → `LIMIT`.

- `WHERE` runs before grouping, so it cannot see aggregates.
- `HAVING` runs after grouping, so it can.
- `HAVING` may only reference grouped columns and aggregates.

## Syntax

```sql-syntax
SELECT group_col, aggregate(expr)
FROM table_name
WHERE row_condition
GROUP BY group_col
HAVING aggregate_condition;
```

## Simple examples

Countries with at least 5 customers:

```sql
SELECT country, COUNT(*) AS customers
FROM customers
GROUP BY country
HAVING COUNT(*) >= 5
ORDER BY customers DESC;
```

Customers with at least 2 orders:

```sql
SELECT customer_id, COUNT(*) AS orders
FROM orders
GROUP BY customer_id
HAVING COUNT(*) >= 2
ORDER BY orders DESC;
```

## Intermediate examples

Combine `WHERE` and `HAVING`. `WHERE` keeps only 1998 orders; `HAVING` keeps customers with 2 or more of them:

```sql
SELECT customer_id, COUNT(*) AS orders_1998
FROM orders
WHERE order_date >= DATE '1998-01-01'
GROUP BY customer_id
HAVING COUNT(*) >= 2
ORDER BY orders_1998 DESC;
```

The `HAVING` aggregate does not need to appear in `SELECT`:

```sql
SELECT category_id
FROM products
GROUP BY category_id
HAVING AVG(unit_price) > 30;
```

## Advanced examples

Compare each group with a global value using a scalar subquery. Customers whose revenue is above the average customer revenue:

```sql
SELECT o.customer_id,
       ROUND(SUM(od.unit_price * od.quantity * (1 - od.discount))::numeric, 2) AS revenue
FROM orders o
JOIN order_details od ON od.order_id = o.order_id
GROUP BY o.customer_id
HAVING SUM(od.unit_price * od.quantity * (1 - od.discount)) >
       (SELECT AVG(t.rev)
        FROM (SELECT SUM(d.unit_price * d.quantity * (1 - d.discount)) AS rev
              FROM orders o2
              JOIN order_details d ON d.order_id = o2.order_id
              GROUP BY o2.customer_id) t)
ORDER BY revenue DESC;
```

Several conditions on different aggregates:

```sql
SELECT employee_id, COUNT(*) AS orders, ROUND(AVG(freight), 2) AS avg_freight
FROM orders
WHERE employee_id IS NOT NULL
GROUP BY employee_id
HAVING COUNT(*) >= 10 AND AVG(freight) > 20;
```

## Real-world scenarios

- Find duplicate emails: `GROUP BY email HAVING COUNT(*) > 1`.
- Managers: employees with at least one direct report.
- Key accounts: customers whose lifetime revenue exceeds a threshold.

```sql
SELECT reports_to AS manager_id, COUNT(*) AS direct_reports
FROM employees
WHERE reports_to IS NOT NULL
GROUP BY reports_to
HAVING COUNT(*) >= 1;
```

## PostgreSQL specifics

- In PostgreSQL you cannot reference a `SELECT` alias in `HAVING` (`HAVING orders > 3` fails). Repeat the expression. MySQL allows the alias; standard SQL does not.
- PostgreSQL allows `HAVING` without `GROUP BY`. The whole table becomes one group.
- `FILTER (WHERE ...)` works inside aggregates used in `HAVING`.

## Visual explanation

```text
rows ──WHERE──▶ kept rows ──GROUP BY──▶ groups + aggregates ──HAVING──▶ kept groups ──▶ SELECT
         (row filter)                                         (group filter)
```

## Common mistakes

- Putting an aggregate in `WHERE`: `ERROR: aggregate functions are not allowed in WHERE`.
- Putting a plain row filter in `HAVING`. It works but filters late, after grouping all rows.
- Using a `SELECT` alias in `HAVING` in PostgreSQL.
- Forgetting that `COUNT(col)` ignores NULLs while `COUNT(*)` does not.

## Performance

- Move every non-aggregate condition into `WHERE`. Fewer rows reach the grouping step.
- `HAVING` itself is cheap. The cost is in the aggregation before it.
- For "exists at least one" checks, `EXISTS` can beat `GROUP BY ... HAVING COUNT(*) >= 1`.

## Interview questions

### What is the difference between WHERE and HAVING?

`WHERE` filters individual rows before grouping and cannot use aggregates. `HAVING` filters groups after aggregation and can.

### Can you use HAVING without GROUP BY?

Yes. The whole result is treated as one group. `SELECT COUNT(*) FROM orders HAVING COUNT(*) > 50` returns one row or none.

### Why does HAVING orders > 3 fail in PostgreSQL?

`HAVING` is evaluated before `SELECT`, so the alias does not exist yet. Repeat `COUNT(*)`.

### How do you find duplicate values?

`SELECT col, COUNT(*) FROM t GROUP BY col HAVING COUNT(*) > 1`.

## Quick revision

- `WHERE` = row filter, before grouping.
- `HAVING` = group filter, after aggregation.
- Aggregates are not allowed in `WHERE`.
- No `SELECT` aliases in `HAVING` in PostgreSQL.
- Put non-aggregate filters in `WHERE` for speed.
- `HAVING` without `GROUP BY` treats the table as one group.
