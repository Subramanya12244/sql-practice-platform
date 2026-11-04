---
title: FULL OUTER JOIN
slug: full-outer-join
category: joins
difficulty: Intermediate
description: SQL FULL OUTER JOIN keeps unmatched rows from both tables. Use it for reconciliation, COALESCE keys, and comparing two datasets in PostgreSQL.
prerequisites: [left-join, right-join]
related: [left-join, right-join, union, except, null-handling]
questions: [51, 52, 54, 55, 57, 58]
patterns: [unmatched-records, missing-records]
guides: [full-outer-join]
minutes: 7
version: 1
---

## Introduction

`FULL OUTER JOIN` combines left and right joins: matched pairs, plus unmatched rows from **both** sides.

## Definition

`A FULL [OUTER] JOIN B ON condition` returns every inner-join pair, every `A` row without a match (with NULL `B` columns), and every `B` row without a match (with NULL `A` columns).

## Why it matters

It is the natural tool for reconciliation: "what is in system X but not Y, and vice versa?" Interviewers test whether you can tell which side a NULL came from.

## How it works

1. Inner join.
2. Add unmatched left rows, NULL-padded.
3. Add unmatched right rows, NULL-padded.

Because either side's key can be NULL, combine keys with `COALESCE(a.key, b.key)`.

## Syntax

```sql-syntax
SELECT COALESCE(a.key, b.key) AS key, a.val, b.val
FROM table_a a
FULL [OUTER] JOIN table_b b ON b.key = a.key;
```

## Simple examples

Customers and orders, including customers with no orders:

```sql
SELECT c.customer_id, o.order_id
FROM customers c
FULL JOIN orders o ON o.customer_id = c.customer_id
WHERE o.order_id IS NULL OR c.customer_id IS NULL;
```

Employees and orders: catches both the order with no employee and any employee with no order.

```sql
SELECT e.employee_id, o.order_id
FROM employees e
FULL JOIN orders o ON o.employee_id = e.employee_id
WHERE e.employee_id IS NULL OR o.order_id IS NULL;
```

## Intermediate examples

Classify every row by where it came from:

```sql
SELECT CASE
         WHEN e.employee_id IS NULL THEN 'order without employee'
         WHEN o.order_id IS NULL    THEN 'employee without orders'
         ELSE 'matched'
       END AS status,
       COUNT(*) AS rows
FROM employees e
FULL JOIN orders o ON o.employee_id = e.employee_id
GROUP BY 1
ORDER BY 1;
```

## Advanced examples

Reconcile two aggregated datasets: first-year order counts vs later order counts per customer. Aggregate **before** joining so each side has one row per key.

```sql
WITH early AS (
  SELECT customer_id, COUNT(*) AS n
  FROM orders
  WHERE order_date < (SELECT MIN(order_date) + 365 FROM orders)
  GROUP BY customer_id
), late AS (
  SELECT customer_id, COUNT(*) AS n
  FROM orders
  WHERE order_date >= (SELECT MIN(order_date) + 365 FROM orders)
  GROUP BY customer_id
)
SELECT COALESCE(e.customer_id, l.customer_id) AS customer_id,
       COALESCE(e.n, 0) AS first_year_orders,
       COALESCE(l.n, 0) AS later_orders
FROM early e
FULL JOIN late l ON l.customer_id = e.customer_id
ORDER BY customer_id
LIMIT 8;
```

## Real-world scenarios

- Reconciling payments vs invoices, or source vs target in a data migration.
- Comparing this period with last period when entities may appear in only one.
- Merging two partial lists into one master list.

## PostgreSQL specifics

- PostgreSQL supports `FULL JOIN` only with merge-joinable or hash-joinable conditions (typically equality). A non-equality `ON` raises "FULL JOIN is only supported with merge-joinable or hash-joinable join conditions".
- MySQL has no `FULL OUTER JOIN`; emulate it with `LEFT JOIN ... UNION ... RIGHT JOIN`.

## Visual explanation

```text
     A            B
  ┌──────┐    ┌──────┐
  │ only │ ∩  │ only │
  │  A   │ AB │  B   │
  └──────┘    └──────┘
FULL JOIN returns all three regions.
B columns are NULL in "only A"; A columns are NULL in "only B".
```

## Common mistakes

- Using `a.key` as the output key: it is NULL for right-only rows. Use `COALESCE(a.key, b.key)`.
- Filtering either side in `WHERE`, which removes unmatched rows from that side.
- Joining raw fact tables, which multiplies rows. Aggregate each side first.
- Grouping by one side's key, which lumps all unmatched rows into a NULL group.

## Performance

Full joins run as hash or merge joins and must read both inputs completely. Reduce each side (filter, aggregate) before joining.

## Interview questions

### When would you use FULL OUTER JOIN?

When rows can be missing on either side and you need to see all of them, such as reconciliations and period comparisons.

### How do you get only the unmatched rows from both sides?

Add `WHERE a.key IS NULL OR b.key IS NULL`.

### How do you emulate FULL OUTER JOIN without it?

`A LEFT JOIN B` combined with `UNION` and `A RIGHT JOIN B` (or `UNION ALL` with an anti-join for the right side).

### Why COALESCE the keys?

Either side's key can be NULL in the result; `COALESCE` gives one non-NULL key per row.

## Quick revision

- Keeps unmatched rows from both tables.
- Output key: `COALESCE(a.key, b.key)`.
- Unmatched only: `WHERE a.key IS NULL OR b.key IS NULL`.
- Aggregate each side before joining.
- PostgreSQL needs an equality-style join condition.
