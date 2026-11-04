---
title: Customers without orders
slug: customers-without-orders
category: missing
difficulty: Beginner
description: List customers who never placed an order (FISSA and PARIS in Northwind) with NOT EXISTS or LEFT JOIN … IS NULL, and show zero counts.
questions: [28, 25, 31, 33]
notes: [left-join, exists-not-exists, in-not-in, count]
guides: [left-join, exists-vs-in]
---

## Problem

Find customers with no orders at all. In Northwind these are FISSA and PARIS.

## When to use it

- Sign-ups who never purchased (activation campaigns).
- The classic "customers who never order" interview question.
- Reports that must show every customer, including those with zero orders.

## Solution

```sql
SELECT c.customer_id, c.company_name
FROM customers c
WHERE NOT EXISTS (
  SELECT 1 FROM orders o WHERE o.customer_id = c.customer_id
)
ORDER BY c.customer_id;
```

## Alternatives

`LEFT JOIN` with an `IS NULL` check:

```sql
SELECT c.customer_id, c.company_name
FROM customers c
LEFT JOIN orders o ON o.customer_id = c.customer_id
WHERE o.order_id IS NULL
ORDER BY c.customer_id;
```

Every customer with an order count, zeros included, sorted so the zeros come first:

```sql
SELECT c.customer_id, COUNT(o.order_id) AS orders
FROM customers c
LEFT JOIN orders o ON o.customer_id = c.customer_id
GROUP BY c.customer_id
ORDER BY orders, c.customer_id
LIMIT 5;
```

`NOT IN` is safe here only because `orders.customer_id` has no NULLs in this data. Write `WHERE customer_id IS NOT NULL` in the subquery anyway:

```sql
SELECT customer_id
FROM customers
WHERE customer_id NOT IN (SELECT customer_id FROM orders WHERE customer_id IS NOT NULL);
```

All four find FISSA and PARIS. `NOT EXISTS` states the intent most clearly and is NULL-safe. The `LEFT JOIN` with `COUNT` suits reports that need every customer.

## How it works

See the anti-join pattern: keep each customer for whom no order row with the same `customer_id` exists. In the count version, `COUNT(o.order_id)` ignores the NULLs produced by the `LEFT JOIN`, so customers without orders get 0.

## Execution walkthrough

1. PostgreSQL hashes `orders.customer_id`.
2. Each customer is probed against the hash.
3. FISSA and PARIS have no entry and are returned.

## Common mistakes

- `COUNT(*)` in the count version. It returns 1 for customers without orders.
- `WHERE o.order_date >= …` after a `LEFT JOIN`, which removes the customers without orders. Put date filters in `ON`.
- `INNER JOIN`, which drops exactly the rows you want.

## Performance

Index `orders.customer_id`. Both main forms run as a hash anti-join.
