---
title: EXCEPT
slug: except
category: set-operators
difficulty: Intermediate
description: Return rows from the first query that are missing from the second with SQL EXCEPT, an anti-join on whole rows in PostgreSQL.
prerequisites: [union, intersect]
related: [intersect, exists-not-exists, in-not-in, left-join]
questions: [28, 29, 30]
patterns: [anti-join, missing-records, customers-without-orders, unmatched-records]
guides: [intersect-except]
minutes: 7
version: 1
---

## Introduction

`EXCEPT` answers "what is in this list but not in that one?". It is set subtraction: A minus B.

## Definition

`query1 EXCEPT query2` returns the distinct rows of `query1` that do not appear in `query2`. `EXCEPT ALL` keeps duplicates: a row appearing m times on the left and n times on the right appears max(m - n, 0) times. Oracle calls it `MINUS`.

## Why it matters

- Finds missing records: customers without orders, products never sold.
- Reconciles two tables: rows in source but not in target.
- Order matters: `A EXCEPT B` is not `B EXCEPT A`.

## How it works

1. Run both queries.
2. Remove duplicates (plain `EXCEPT`).
3. Keep left rows that have no equal row on the right, comparing every column.

## Syntax

```sql-syntax
SELECT col1, col2 FROM table_a
EXCEPT [ALL]
SELECT col1, col2 FROM table_b;
```

## Simple examples

Customers who never ordered (FISSA and PARIS):

```sql
SELECT customer_id FROM customers
EXCEPT
SELECT customer_id FROM orders;
```

Products never ordered (9 and 17):

```sql
SELECT product_id FROM products
EXCEPT
SELECT product_id FROM order_details
ORDER BY product_id;
```

## Intermediate examples

Direction matters. Customer countries with no supplier (9), versus supplier countries with no customer (4):

```sql
SELECT country FROM customers
EXCEPT
SELECT country FROM suppliers
ORDER BY country;
```

```sql
SELECT country FROM suppliers
EXCEPT
SELECT country FROM customers
ORDER BY country;
```

## Advanced examples

`EXCEPT` returns only the compared columns. Join back for details:

```sql
SELECT c.customer_id, c.company_name, c.country
FROM customers c
JOIN (
  SELECT customer_id FROM customers
  EXCEPT
  SELECT customer_id FROM orders
) missing USING (customer_id);
```

The `NOT EXISTS` equivalent, which most interviewers expect too:

```sql
SELECT c.customer_id, c.company_name
FROM customers c
WHERE NOT EXISTS (SELECT 1 FROM orders o WHERE o.customer_id = c.customer_id);
```

Products sold by employee 1 but never by employee 4:

```sql
SELECT od.product_id FROM order_details od JOIN orders o USING (order_id) WHERE o.employee_id = 1
EXCEPT
SELECT od.product_id FROM order_details od JOIN orders o USING (order_id) WHERE o.employee_id = 4
ORDER BY product_id;
```

## Real-world scenarios

- Churned customers: active last period, not this one.
- Data reconciliation between staging and production tables.
- Finding unused reference data, such as products never sold.

## PostgreSQL specifics

- PostgreSQL supports `EXCEPT` and `EXCEPT ALL`. It has no `MINUS` keyword; Oracle does.
- NULLs compare as equal. That makes `EXCEPT` safe where `NOT IN` breaks: `NOT IN` returns no rows if the subquery yields a NULL.
- `EXCEPT` has the same precedence as `UNION`, evaluated left to right. `INTERSECT` binds tighter.

## Visual explanation

```text
 customers.country     suppliers.country
   +-----------+---------+-----------+
   |  EXCEPT   |  both   |           |
   |  (9 rows) |  (12)   |  4 only   |
   +-----------+---------+-----------+
   customers EXCEPT suppliers = left part only
```

## Common mistakes

- Swapping the operands and getting the opposite answer.
- Selecting extra columns: a row is removed only if all selected columns match.
- Expecting duplicates to survive. Use `EXCEPT ALL` for that.
- Using `NOT IN` with a nullable column instead; it returns nothing if a NULL is present.

## Performance

`EXCEPT` hashes or sorts both inputs in full. `NOT EXISTS` becomes an anti-join that can use an index on the inner key, so it often wins on large tables. Both are fine on small data.

## Interview questions

### How do you find customers with no orders?

`SELECT customer_id FROM customers EXCEPT SELECT customer_id FROM orders`, or `NOT EXISTS`, or `LEFT JOIN ... WHERE o.order_id IS NULL`.

### Is A EXCEPT B the same as B EXCEPT A?

No. It returns rows of the left query missing from the right query.

### Why prefer EXCEPT or NOT EXISTS over NOT IN?

If the `NOT IN` subquery returns a NULL, the condition is never true and the result is empty. `EXCEPT` and `NOT EXISTS` handle NULLs safely.

### What does EXCEPT ALL return?

Each left row max(m - n, 0) times.

## Quick revision

- `EXCEPT` = rows in left result, not in right, distinct.
- Order of operands matters.
- `EXCEPT ALL` keeps max(m - n, 0) copies.
- NULLs match NULLs, unlike `NOT IN`.
- Join back to get more columns.
- `NOT EXISTS` is the usual alternative.
