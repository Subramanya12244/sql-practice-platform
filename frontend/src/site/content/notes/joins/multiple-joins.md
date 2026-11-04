---
title: Multiple joins
slug: multiple-joins
category: joins
difficulty: Intermediate
description: Chain three or more joins in SQL - follow the key path, mix inner and outer joins safely, and aggregate multi-table revenue without double counting.
prerequisites: [inner-join, left-join]
related: [join-cardinality, inner-join, left-join, cte, group-by]
questions: [2, 3, 4, 10, 11, 32]
patterns: []
guides: [inner-join, left-join]
minutes: 8
version: 1
---

## Introduction

Real questions span many tables: "revenue by category per customer" touches customers, orders, order_details, products and categories. Multiple joins chain these together along their keys.

## Definition

A multi-join query applies joins left to right: `A JOIN B ON ... JOIN C ON ...` joins `C` to the result of `A JOIN B`. Each `ON` can reference any table already joined.

## Why it matters

Most interview problems need three to five tables. The skills tested: finding the key path, keeping outer joins outer, and avoiding fan-out when aggregating.

## How it works

Follow the foreign keys in Northwind:

```text
customers ─ orders ─ order_details ─ products ─ categories
              │                         └──── suppliers
          employees, shippers (ship_via)
```

Joins are evaluated left to right in the logical model. The planner can reorder inner joins freely, but outer joins restrict reordering.

## Syntax

```sql-syntax
SELECT ...
FROM a
JOIN b ON b.a_id = a.id
JOIN c ON c.b_id = b.id
LEFT JOIN d ON d.c_id = c.id;
```

## Simple examples

Order lines with customer and product names (four tables):

```sql
SELECT o.order_id, c.company_name, p.product_name, od.quantity
FROM orders o
JOIN customers c      ON c.customer_id = o.customer_id
JOIN order_details od ON od.order_id   = o.order_id
JOIN products p       ON p.product_id  = od.product_id
ORDER BY o.order_id, p.product_name
LIMIT 6;
```

## Intermediate examples

Revenue by category (order_details → products → categories):

```sql
SELECT cat.category_name,
       ROUND(SUM(od.unit_price * od.quantity * (1 - od.discount))::numeric, 2) AS revenue
FROM order_details od
JOIN products p     ON p.product_id = od.product_id
JOIN categories cat ON cat.category_id = p.category_id
GROUP BY cat.category_name
ORDER BY revenue DESC;
```

Revenue by shipper (order_details → orders → shippers):

```sql
SELECT s.company_name,
       ROUND(SUM(od.unit_price * od.quantity * (1 - od.discount))::numeric, 2) AS revenue
FROM order_details od
JOIN orders o   ON o.order_id = od.order_id
JOIN shippers s ON s.shipper_id = o.ship_via
GROUP BY s.company_name
ORDER BY revenue DESC;
```

## Advanced examples

Customers by number of distinct categories bought, keeping customers with none. Every join after the first `LEFT JOIN` must also be `LEFT`:

```sql
SELECT c.customer_id,
       COUNT(DISTINCT p.category_id) AS categories_bought
FROM customers c
LEFT JOIN orders o         ON o.customer_id = c.customer_id
LEFT JOIN order_details od ON od.order_id   = o.order_id
LEFT JOIN products p       ON p.product_id  = od.product_id
GROUP BY c.customer_id
ORDER BY categories_bought DESC, c.customer_id
LIMIT 5;
```

Avoid double counting when mixing parent and child measures: `freight` lives on `orders`, revenue on `order_details`. Aggregate lines per order first.

```sql
WITH order_rev AS (
  SELECT order_id, SUM(unit_price * quantity * (1 - discount)) AS revenue
  FROM order_details
  GROUP BY order_id
)
SELECT o.employee_id,
       ROUND(SUM(r.revenue)::numeric, 2) AS revenue,
       SUM(o.freight)                    AS freight
FROM orders o
JOIN order_rev r ON r.order_id = o.order_id
WHERE o.employee_id IS NOT NULL
GROUP BY o.employee_id
ORDER BY revenue DESC
LIMIT 5;
```

## Real-world scenarios

- Star-schema reports: one fact table joined to several dimensions.
- Customer 360 views combining orders, payments and support tickets.
- Data exports that denormalise many tables.

## PostgreSQL specifics

- With more than `join_collapse_limit` (default 8) explicit joins, the planner stops searching all join orders and follows the written order more closely.
- `from_collapse_limit` (default 8) controls flattening of subqueries in `FROM`.
- PostgreSQL does not create indexes on foreign-key columns automatically.

## Visual explanation

```text
order_details (1 row per line)
   │ product_id → products (1)      → categories (1)
   │ order_id   → orders (1)        → customers (1), shippers (1)
Each step is many-to-one: row count stays = number of order lines.
Joining "upwards" from the fact table never fans out.
```

## Common mistakes

- An `INNER JOIN` after a `LEFT JOIN` on the optional side, which silently drops the unmatched rows.
- Summing a parent-level column (`freight`) after joining child rows.
- Joining two independent child tables of the same parent, which multiplies rows (many × many).
- Skipping a table in the path (joining `orders` to `products` directly).
- Missing aliases in long queries.

## Performance

Start from the most selective filter, index every foreign key, and pre-aggregate child tables in a CTE or subquery before joining when you only need totals. Check `EXPLAIN ANALYZE` row estimates; bad estimates on long chains cause poor join orders.

## Interview questions

### In what order are multiple joins evaluated?

Logically left to right. The planner may reorder inner joins for speed, but the result is the same.

### Why does a LEFT JOIN followed by an INNER JOIN lose rows?

The inner join requires a match on the NULL-extended columns, which fails, so those rows are removed.

### How do you avoid double counting across joins?

Aggregate each child table to the parent's grain before joining, or join only many-to-one from the fact table.

### What happens when you join two child tables of the same parent?

Rows multiply: each parent produces (children in A) × (children in B) rows.

## Quick revision

- Follow the foreign-key path; do not skip tables.
- Once `LEFT`, stay `LEFT` along the optional chain.
- Join many-to-one from the fact table to avoid fan-out.
- Pre-aggregate before joining parent-level measures.
- Index every join key.
