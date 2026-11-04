---
title: LEFT JOIN
slug: left-join
category: joins
difficulty: Beginner
description: Keep every row from the left table with SQL LEFT JOIN - zero-filled reports, anti-joins with IS NULL, and the ON vs WHERE filter trap.
prerequisites: [inner-join]
related: [right-join, full-outer-join, exists-not-exists, null-handling, join-cardinality]
questions: [25, 27, 28, 29, 31, 35]
patterns: [anti-join, customers-without-orders, unmatched-records, missing-records]
guides: [left-join]
minutes: 8
version: 1
---

## Introduction

`INNER JOIN` drops rows that have no match. When the question says "all customers", "including those with none" or "never ordered", you need `LEFT JOIN`.

## Definition

`A LEFT [OUTER] JOIN B ON condition` returns every matched pair, plus each row of `A` that matched nothing, with NULLs in `B`'s columns.

## Why it matters

Zero-filled reports and "find missing records" questions depend on it. The classic interview trap is a `WHERE` filter on the right table that silently turns the left join into an inner join.

## How it works

1. Compute the inner join.
2. For each left row with no match, add one row with NULLs for every right column.

The `ON` condition decides matching. `WHERE` then filters the joined result, including the NULL-extended rows.

## Syntax

```sql-syntax
SELECT a.*, b.*
FROM table_a a
LEFT [OUTER] JOIN table_b b ON b.a_id = a.id;

-- anti-join: rows of a with no match in b
SELECT a.*
FROM table_a a
LEFT JOIN table_b b ON b.a_id = a.id
WHERE b.a_id IS NULL;
```

## Simple examples

Every customer with order count, including zero:

```sql
SELECT c.customer_id, c.company_name, COUNT(o.order_id) AS orders
FROM customers c
LEFT JOIN orders o ON o.customer_id = c.customer_id
GROUP BY c.customer_id, c.company_name
ORDER BY orders, c.customer_id
LIMIT 5;
```

Customers with no orders (anti-join):

```sql
SELECT c.customer_id, c.company_name
FROM customers c
LEFT JOIN orders o ON o.customer_id = c.customer_id
WHERE o.order_id IS NULL;
```

## Intermediate examples

Products never ordered:

```sql
SELECT p.product_id, p.product_name
FROM products p
LEFT JOIN order_details od ON od.product_id = p.product_id
WHERE od.product_id IS NULL;
```

Zero-fill a sum with `COALESCE`:

```sql
SELECT p.product_name, COALESCE(SUM(od.quantity), 0) AS units_sold
FROM products p
LEFT JOIN order_details od ON od.product_id = p.product_id
GROUP BY p.product_name
ORDER BY units_sold, p.product_name
LIMIT 5;
```

## Advanced examples

The ON vs WHERE trap. Filtering the right table in `WHERE` removes the unmatched customers; filtering in `ON` keeps them.

```sql
SELECT
  (SELECT COUNT(DISTINCT c.customer_id)
     FROM customers c
     LEFT JOIN orders o ON o.customer_id = c.customer_id
    WHERE o.ship_via = 1)                                   AS filter_in_where,
  (SELECT COUNT(DISTINCT c.customer_id)
     FROM customers c
     LEFT JOIN orders o ON o.customer_id = c.customer_id
                       AND o.ship_via = 1)                  AS filter_in_on;
```

Chained left joins: customer revenue, keeping customers with no orders. Every later join must also be `LEFT`.

```sql
SELECT c.customer_id,
       ROUND(COALESCE(SUM(od.unit_price * od.quantity * (1 - od.discount)), 0)::numeric, 2) AS revenue
FROM customers c
LEFT JOIN orders o         ON o.customer_id = c.customer_id
LEFT JOIN order_details od ON od.order_id   = o.order_id
GROUP BY c.customer_id
ORDER BY revenue, c.customer_id
LIMIT 5;
```

## Real-world scenarios

- Reports that must list every entity, including inactive ones.
- Finding orphans: customers without orders, products never sold.
- Optional attributes stored in a side table.

## PostgreSQL specifics

- `LEFT JOIN` and `LEFT OUTER JOIN` are identical.
- The planner turns `LEFT JOIN ... WHERE b.key IS NULL` and `NOT EXISTS` into the same anti-join plan in most cases.
- PostgreSQL can remove an unused left join to a table with a unique key ("join removal").

## Visual explanation

```text
customers c              orders o
ALFKI ─────────────────► 10643, 10692, ...
FISSA ─────────────────► (no match) → order_id = NULL
PARIS ─────────────────► (no match) → order_id = NULL

WHERE o.order_id IS NULL → FISSA, PARIS
```

## Common mistakes

- `WHERE right.col = value` after a `LEFT JOIN`: turns it into an inner join. Put the filter in `ON`.
- `COUNT(*)` instead of `COUNT(right.key)`: counts the NULL row as 1.
- Following a `LEFT JOIN` with an `INNER JOIN` on the right table, which drops the unmatched rows again.
- Anti-join on a nullable column: test `IS NULL` on the right table's join key or primary key.
- Forgetting `COALESCE` for zero-filled sums.

## Performance

Index the right table's join column. Anti-joins via `LEFT JOIN ... IS NULL` and `NOT EXISTS` usually plan identically; `NOT IN` is slower and NULL-unsafe. Aggregating the right table before joining avoids fan-out on wide chains.

## Interview questions

### What is the difference between INNER JOIN and LEFT JOIN?

`INNER JOIN` keeps only matches. `LEFT JOIN` also keeps unmatched left rows with NULLs for the right side.

### How do you find customers who never placed an order?

`LEFT JOIN orders ... WHERE o.order_id IS NULL`, or `WHERE NOT EXISTS (SELECT 1 FROM orders o WHERE o.customer_id = c.customer_id)`.

### Why does adding a WHERE condition on the right table change the row count?

Unmatched rows have NULL in right columns, so the condition is NULL and the row is removed. Move the condition into `ON`.

### Why use COUNT(o.order_id) instead of COUNT(*) after a LEFT JOIN?

`COUNT(*)` counts the NULL-extended row, so customers with no orders would show 1.

## Quick revision

- Keeps all left rows; unmatched right columns are NULL.
- Anti-join: `LEFT JOIN ... WHERE right.key IS NULL`.
- Right-table filters go in `ON`, not `WHERE`.
- Count `right.key`, not `*`.
- `COALESCE(SUM(...), 0)` for zero-filled totals.
- Keep later joins `LEFT` in a chain.
