---
title: Anti-join
slug: anti-join
category: missing
difficulty: Intermediate
description: Return rows with no match in another table using NOT EXISTS, LEFT JOIN … IS NULL, or EXCEPT, and avoid the NOT IN NULL trap.
questions: [28, 29, 30, 61]
notes: [exists-not-exists, left-join, in-not-in, except]
guides: [exists-vs-in, left-join]
---

## Problem

Return rows from table A that have no matching row in table B, for example products that never appear in `order_details`.

## When to use it

- "Never", "without", "not in", "has no" questions.
- Finding orphans before you add a foreign key.

## Solution

```sql
SELECT p.product_id, p.product_name
FROM products p
WHERE NOT EXISTS (
  SELECT 1
  FROM order_details od
  WHERE od.product_id = p.product_id
);
```

## Alternatives

`LEFT JOIN` and keep the unmatched rows:

```sql
SELECT p.product_id, p.product_name
FROM products p
LEFT JOIN order_details od ON od.product_id = p.product_id
WHERE od.product_id IS NULL;
```

`EXCEPT` on the key:

```sql
SELECT product_id FROM products
EXCEPT
SELECT product_id FROM order_details;
```

`NOT IN` works only when the subquery cannot return NULL. Filter NULLs explicitly, even when the column is NOT NULL today:

```sql
SELECT p.product_id, p.product_name
FROM products p
WHERE p.product_id NOT IN (
  SELECT od.product_id FROM order_details od WHERE od.product_id IS NOT NULL
);
```

If the subquery returns even one NULL, `NOT IN` returns no rows at all. For example `orders.employee_id` contains a NULL, so `WHERE employee_id NOT IN (SELECT employee_id FROM orders)` is empty. `NOT EXISTS` and `LEFT JOIN … IS NULL` usually get the same plan (a hash anti-join) in PostgreSQL. `EXCEPT` compares whole rows and removes duplicates.

## How it works

`NOT EXISTS` stops at the first matching row and keeps the outer row only when none is found. `LEFT JOIN` keeps every left row and fills the right columns with NULL when there is no match. Testing a right-side NOT NULL column for `IS NULL` keeps exactly those rows.

## Execution walkthrough

1. PostgreSQL builds a hash table of `order_details.product_id`.
2. It probes the hash for each product.
3. Products 9 and 17 find no entry, so they are returned.

## Common mistakes

- `NOT IN (subquery)` where the subquery can return NULL. `x NOT IN (1, NULL)` is never true.
- In the `LEFT JOIN` form, testing a nullable right column, or putting extra right-side filters in `WHERE` instead of `ON`.
- A `LEFT JOIN` with extra joined tables that multiply rows. `NOT EXISTS` never duplicates rows.

## Performance

Index the foreign-key column on the inner table (`order_details.product_id`). `NOT EXISTS` and `LEFT JOIN … IS NULL` both become anti-joins. `NOT IN` with a subquery can become a slow per-row scan because of NULL semantics.
