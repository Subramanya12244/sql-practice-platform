---
title: IN and NOT IN
slug: in-not-in
category: subqueries
difficulty: Beginner
description: IN checks membership in a list or subquery; NOT IN breaks silently when the subquery returns a NULL. Learn when to use each.
prerequisites: [where, null-handling]
related: [exists-not-exists, scalar-subqueries, logical-operators, except]
questions: [28, 29, 30, 170]
patterns: [anti-join, unmatched-records]
guides: [exists-vs-in]
minutes: 6
version: 1
---

## Introduction

`IN` is the shortest way to say "value is one of these". It works with a literal list or a subquery. Its opposite, `NOT IN`, has a NULL problem that is a favourite interview question.

## Definition

`x IN (a, b, c)` is equivalent to `x = a OR x = b OR x = c`. `x NOT IN (...)` is equivalent to `x <> a AND x <> b AND x <> c`. With a subquery, the list is the subquery's single column.

## Why it matters

- It replaces long `OR` chains.
- It filters rows by membership in another table.
- It explains how three-valued logic behaves with NULLs.

## How it works

For a subquery, PostgreSQL usually builds a hashed set or a semi-join. For `NOT IN`, any NULL in the list makes each comparison `x <> NULL`, which is UNKNOWN. A row whose value is not in the list therefore gets UNKNOWN instead of TRUE and is filtered out.

## Syntax

```sql-syntax
WHERE col IN (value1, value2, ...)
WHERE col IN (SELECT col FROM other_table WHERE ...)
WHERE col NOT IN (SELECT col FROM other_table WHERE col IS NOT NULL)
```

## Simple examples

```sql
SELECT customer_id, company_name, country
FROM customers
WHERE country IN ('Germany', 'France')
ORDER BY country, customer_id;
```

Products in the Beverages or Seafood categories, using a subquery:

```sql
SELECT product_name, category_id
FROM products
WHERE category_id IN (SELECT category_id FROM categories
                      WHERE category_name IN ('Beverages', 'Seafood'))
ORDER BY category_id;
```

## Intermediate examples

Customers with no orders using `NOT IN`. It is safe here only because `orders.customer_id` has no NULLs:

```sql
SELECT customer_id
FROM customers
WHERE customer_id NOT IN (SELECT customer_id FROM orders);
```

## Advanced examples

The NULL trap. `orders.employee_id` contains one NULL, so this query returns **0 rows** even though it looks correct:

```sql-syntax
SELECT employee_id FROM employees
WHERE employee_id NOT IN (SELECT employee_id FROM orders);   -- 0 rows
```

The cause is a single NULL:

```sql
SELECT COUNT(*) AS null_employee_orders
FROM orders WHERE employee_id IS NULL;
```

Fix it by excluding NULLs. This query and the `NOT EXISTS` version return the same rows. In this data every employee has orders, so both return none. The `COUNT` below shows that they agree:

```sql
SELECT
  (SELECT COUNT(*) FROM employees
   WHERE employee_id NOT IN (SELECT employee_id FROM orders WHERE employee_id IS NOT NULL)) AS not_in_safe,
  (SELECT COUNT(*) FROM employees e
   WHERE NOT EXISTS (SELECT 1 FROM orders o WHERE o.employee_id = e.employee_id)) AS not_exists;
```

Row-value `IN` compares several columns at once:

```sql
SELECT order_id, product_id, quantity
FROM order_details
WHERE (order_id, product_id) IN (SELECT order_id, product_id FROM order_details WHERE quantity >= 30)
ORDER BY quantity DESC
LIMIT 5;
```

## Real-world scenarios

- Filtering by a small fixed set of statuses or countries.
- Restricting rows to IDs from another query, such as customers in a target segment.
- Excluding blocked IDs. Use `NOT EXISTS` unless the column is `NOT NULL`.

## PostgreSQL specifics

- `x = ANY(array)` is PostgreSQL's array form of `IN`, and it is useful with parameters: `WHERE id = ANY($1)`.
- `NOT IN (subquery)` cannot become a hash anti-join because of NULL semantics. It often becomes a hashed SubPlan, or a slow plain SubPlan when the list is large.
- An empty `IN ()` list is a syntax error. An `IN` subquery that returns no rows is FALSE.

## Visual explanation

| Expression | List | Result |
|---|---|---|
| `3 IN (1, 2, 3)` | no NULL | TRUE |
| `4 IN (1, 2, NULL)` | has NULL | UNKNOWN (filtered) |
| `4 NOT IN (1, 2)` | no NULL | TRUE |
| `4 NOT IN (1, 2, NULL)` | has NULL | UNKNOWN (filtered) |

## Common mistakes

- Using `NOT IN` with a nullable subquery column, which silently returns zero rows.
- Returning several columns from a subquery for a single-column `IN`.
- Listing thousands of literal values in `IN` instead of joining to a table or using `= ANY(array)`.

## Performance

`IN (subquery)` is planned as a semi-join, so it is about as fast as `EXISTS`. `NOT IN (subquery)` is usually slower than `NOT EXISTS` on large inputs because PostgreSQL cannot use an anti-join. Prefer `NOT EXISTS`.

## Interview questions

### Why does `NOT IN` return no rows when the subquery has a NULL?

`x NOT IN (..., NULL)` expands to `... AND x <> NULL`. `x <> NULL` is UNKNOWN, so the whole condition is never TRUE.

### IN vs EXISTS: which to use?

They give the same result for positive checks, and PostgreSQL plans both as semi-joins. For negative checks, use `NOT EXISTS`.

### How do you make NOT IN safe?

Add `WHERE col IS NOT NULL` in the subquery, or rewrite it as `NOT EXISTS`.

### Does `IN` return duplicates if the subquery has duplicate values?

No. `IN` tests membership, so each outer row appears at most once.

## Quick revision

- `IN` is shorthand for a chain of `=` ... `OR`.
- `NOT IN` is shorthand for a chain of `<>` ... `AND`.
- One NULL in a `NOT IN` list gives zero rows.
- Prefer `NOT EXISTS` for anti-joins.
- `= ANY(array)` is PostgreSQL's array form.
- `IN (subquery)` never duplicates outer rows.
