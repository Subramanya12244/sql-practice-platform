---
title: INNER JOIN
slug: inner-join
category: joins
difficulty: Beginner
description: Combine matching rows from two tables with SQL INNER JOIN - ON vs USING, multi-table joins, non-equi joins and row-count pitfalls in PostgreSQL.
prerequisites: [select, where]
related: [left-join, multiple-joins, join-cardinality, self-join, join-vs-subquery]
questions: [1, 2, 3, 11, 12]
patterns: []
guides: [inner-join]
minutes: 8
version: 1
---

## Introduction

Data is split across tables to avoid repetition. `INNER JOIN` puts it back together: it pairs rows from two tables wherever the join condition is true.

## Definition

`A INNER JOIN B ON condition` returns one row for every pair `(a, b)` where `condition` is TRUE. Rows without a match on either side are dropped. `JOIN` alone means `INNER JOIN`.

## Why it matters

Nearly every report joins facts (orders, order lines) to dimensions (customers, products). Interviewers check join keys, row counts and when unmatched rows disappear.

## How it works

Conceptually: take every combination of rows (a Cartesian product), then keep those where `ON` is TRUE. A NULL key never matches, because `NULL = x` is NULL. If one row matches many rows, it appears many times.

## Syntax

```sql-syntax
SELECT a.col, b.col
FROM table_a AS a
[INNER] JOIN table_b AS b
  ON b.a_id = a.id;

-- same-named key columns
SELECT ... FROM table_a JOIN table_b USING (key_col);
```

## Simple examples

Orders with the customer's company name:

```sql
SELECT o.order_id, o.order_date, c.company_name
FROM orders o
JOIN customers c ON c.customer_id = o.customer_id
ORDER BY o.order_id
LIMIT 5;
```

Products with their category, using `USING`:

```sql
SELECT product_name, category_name
FROM products
JOIN categories USING (category_id)
ORDER BY product_name
LIMIT 5;
```

## Intermediate examples

Revenue per product (join, then aggregate):

```sql
SELECT p.product_name,
       ROUND(SUM(od.unit_price * od.quantity * (1 - od.discount))::numeric, 2) AS revenue
FROM order_details od
JOIN products p ON p.product_id = od.product_id
GROUP BY p.product_name
ORDER BY revenue DESC
LIMIT 5;
```

Unmatched rows vanish: the order with a NULL `employee_id` is not in this count.

```sql
SELECT (SELECT COUNT(*) FROM orders)                                   AS all_orders,
       (SELECT COUNT(*) FROM orders o
          JOIN employees e ON e.employee_id = o.employee_id)          AS joined_orders;
```

## Advanced examples

Composite condition: filter inside `ON` (equivalent to `WHERE` for inner joins).

```sql
SELECT o.order_id, s.company_name AS shipper, o.freight
FROM orders o
JOIN shippers s ON s.shipper_id = o.ship_via AND o.freight > 100
ORDER BY o.freight DESC
LIMIT 5;
```

Non-equi join: products priced above their category's average.

```sql
SELECT p.product_name, p.unit_price, ROUND(ca.avg_price, 2) AS category_avg
FROM products p
JOIN (SELECT category_id, AVG(unit_price) AS avg_price
      FROM products GROUP BY category_id) ca
  ON ca.category_id = p.category_id
 AND p.unit_price > ca.avg_price
ORDER BY p.unit_price DESC
LIMIT 5;
```

## Real-world scenarios

- Enriching transactions with customer, product and employee details.
- Revenue by category, shipper or employee.
- Matching records between two systems on a shared key.

## PostgreSQL specifics

- `USING (col)` outputs a single merged `col`; `NATURAL JOIN` joins on all same-named columns, which is fragile and best avoided.
- Comma joins (`FROM a, b WHERE a.id = b.id`) are equivalent to inner joins but easy to get wrong.
- The planner picks nested loop, hash or merge join; you do not choose in SQL.

## Visual explanation

```text
orders                 customers
order_id customer_id   customer_id company_name
10248    ALFKI   ───►  ALFKI       Alfreds Futterkiste
10249    ANATR   ───►  ANATR       Ana Trujillo Emparedados
(no order)             FISSA       FISSA Fabrica Inter. Salchichas   ✗ dropped
```

Only pairs that satisfy the `ON` condition reach the result.

## Common mistakes

- Joining on the wrong column (for example `orders.employee_id = customers.customer_id`).
- Forgetting a join condition, which produces a Cartesian product.
- Expecting customers with no orders to appear: use `LEFT JOIN`.
- Summing a parent column (such as `freight`) after joining to child rows, which double counts.
- Ambiguous column names without table aliases.

## Performance

Index the foreign-key columns used in joins (`orders.customer_id`, `order_details.product_id`). PostgreSQL does not create indexes on foreign keys automatically. Filter and aggregate early to reduce the rows being joined. `EXPLAIN ANALYZE` shows the join strategy and actual row counts.

## Interview questions

### What does INNER JOIN return?

Only row pairs where the join condition is TRUE. Unmatched rows from both sides are excluded.

### Is there a difference between putting a filter in ON or WHERE for an inner join?

No difference in result for inner joins. For outer joins it matters a lot.

### Do NULL keys match in a join?

No. `NULL = NULL` is NULL, so rows with NULL keys never pair up in an equality join.

### Why can a join return more rows than either table?

One-to-many or many-to-many relationships repeat each row once per match.

## Quick revision

- `JOIN` = `INNER JOIN`: matched pairs only.
- Unmatched and NULL-key rows are dropped.
- Join on keys, alias every table.
- One-to-many joins multiply rows; aggregate at the right grain.
- Index foreign-key columns.
