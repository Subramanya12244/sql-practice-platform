---
title: Unmatched records
slug: unmatched-records
category: missing
difficulty: Intermediate
description: Find rows on either side of a relationship that have no partner, using FULL OUTER JOIN with IS NULL checks or two anti-joins.
questions: [51, 52, 54, 55, 29]
notes: [full-outer-join, left-join, exists-not-exists, except]
guides: [full-outer-join, left-join]
---

## Problem

Compare two sets and list the rows that exist on only one side. Examples: customers with no orders and orders with no employee, or two copies of a table that should match.

## When to use it

- Reconciling two systems or two loads of the same data.
- Finding orphan rows (a foreign key value with no parent, or a parent with no children).
- Interview prompts with "in A but not in B, or in B but not in A".

## Solution

One `FULL OUTER JOIN` shows both kinds of mismatch. Here the right side is employees, and orders include the one order with a NULL `employee_id`:

```sql
SELECT e.employee_id,
       o.order_id,
       CASE WHEN e.employee_id IS NULL THEN 'order without employee'
            ELSE 'employee without orders' END AS issue
FROM employees e
FULL OUTER JOIN orders o ON o.employee_id = e.employee_id
WHERE e.employee_id IS NULL
   OR o.order_id IS NULL;
```

## Alternatives

Two anti-joins combined with `UNION ALL`, which is easier to read when the two sides need different columns:

```sql
SELECT 'customer without orders' AS issue, c.customer_id AS id
FROM customers c
WHERE NOT EXISTS (SELECT 1 FROM orders o WHERE o.customer_id = c.customer_id)
UNION ALL
SELECT 'product never ordered', p.product_id::text
FROM products p
WHERE NOT EXISTS (SELECT 1 FROM order_details od WHERE od.product_id = p.product_id);
```

Comparing two versions of a set with `EXCEPT` (symmetric difference):

```sql
WITH a AS (SELECT DISTINCT country FROM customers),
     b AS (SELECT DISTINCT country FROM suppliers)
(SELECT 'only customers' AS side, country FROM a EXCEPT SELECT 'only customers', country FROM b)
UNION ALL
(SELECT 'only suppliers', country FROM b EXCEPT SELECT 'only suppliers', country FROM a)
ORDER BY side, country;
```

`FULL OUTER JOIN` needs one equality join key and gives both sides in one pass. `EXCEPT` compares whole rows and treats NULLs as equal, but removes duplicates. Anti-joins are the most flexible.

## How it works

A `FULL OUTER JOIN` returns matched pairs, plus left rows padded with NULLs, plus right rows padded with NULLs. Testing a NOT NULL column (usually the key) for `IS NULL` keeps only the padded rows, which are the mismatches.

## Execution walkthrough

1. PostgreSQL joins every order to its employee.
2. The order with a NULL `employee_id` matches nobody, so it appears with NULL employee columns.
3. Any employee with no orders appears with NULL order columns.
4. `WHERE … IS NULL OR … IS NULL` removes all matched pairs.
5. `CASE` labels which side the row came from.

## Common mistakes

- Testing a nullable column for `IS NULL`. Test the join key or primary key of the padded side.
- Using `NOT IN` with a subquery that can return NULL. One NULL makes `NOT IN` return no rows.
- Adding a `WHERE` filter on one side before the mismatch check, which drops that side's padded rows.

## Performance

PostgreSQL runs `FULL OUTER JOIN` as a hash or merge join, so it supports only equality-based join conditions (merge-joinable or hash-joinable). `NOT EXISTS` becomes a hash anti-join and is usually the cheapest form. Index the foreign-key columns.
