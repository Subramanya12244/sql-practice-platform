---
title: INTERSECT
slug: intersect
category: set-operators
difficulty: Intermediate
description: Return only the rows that appear in both query results with SQL INTERSECT, and compare it with EXISTS and INNER JOIN in PostgreSQL.
prerequisites: [union]
related: [except, union, exists-not-exists, inner-join, in-not-in]
questions: [79, 85, 93]
patterns: []
guides: [intersect-except]
minutes: 7
version: 1
---

## Introduction

`INTERSECT` answers "what do these two lists have in common?". It keeps a row only if both queries return it.

## Definition

`query1 INTERSECT query2` returns the distinct rows that appear in both results. `INTERSECT ALL` keeps duplicates: a row appearing m and n times appears min(m, n) times.

## Why it matters

- Overlap questions: countries with both customers and suppliers, products sold by two employees.
- Compares whole rows, with NULLs treated as equal, which a JOIN on `=` does not do.
- Interviewers ask for the `EXISTS` or JOIN rewrite.

## How it works

1. Run both queries.
2. Remove duplicates from each side (plain `INTERSECT`).
3. Keep rows present on both sides, comparing every column.

## Syntax

```sql-syntax
SELECT col1, col2 FROM table_a
INTERSECT [ALL]
SELECT col1, col2 FROM table_b;
```

## Simple examples

Countries with both customers and suppliers (12 in this data):

```sql
SELECT country FROM customers
INTERSECT
SELECT country FROM suppliers
ORDER BY country;
```

Countries that have both an employee and a customer:

```sql
SELECT country FROM employees
INTERSECT
SELECT country FROM customers;
```

## Intermediate examples

Multi-column match: country and city pairs shared by customers and suppliers:

```sql
SELECT country, city FROM customers
INTERSECT
SELECT country, city FROM suppliers
ORDER BY country, city;
```

Products sold by both employee 1 and employee 4:

```sql
SELECT od.product_id FROM order_details od JOIN orders o USING (order_id) WHERE o.employee_id = 1
INTERSECT
SELECT od.product_id FROM order_details od JOIN orders o USING (order_id) WHERE o.employee_id = 4
ORDER BY product_id;
```

## Advanced examples

The same overlap with `EXISTS`, useful when you need extra columns from one side:

```sql
SELECT p.product_id, p.product_name
FROM products p
WHERE EXISTS (SELECT 1 FROM order_details od JOIN orders o USING (order_id)
              WHERE od.product_id = p.product_id AND o.employee_id = 1)
  AND EXISTS (SELECT 1 FROM order_details od JOIN orders o USING (order_id)
              WHERE od.product_id = p.product_id AND o.employee_id = 4)
ORDER BY p.product_id;
```

`INTERSECT ALL` keeps multiplicity. Each country appears min(customer count, supplier count) times:

```sql
SELECT country, COUNT(*) AS times
FROM (
  SELECT country FROM customers
  INTERSECT ALL
  SELECT country FROM suppliers
) x
GROUP BY country
ORDER BY times DESC, country
LIMIT 5;
```

## Real-world scenarios

- Users active in two periods (retention).
- Products sold in two regions.
- Reconciling two systems: keys present in both.

## PostgreSQL specifics

- PostgreSQL supports `INTERSECT` and `INTERSECT ALL`. MySQL added `INTERSECT` only in 8.0.31.
- `INTERSECT` binds tighter than `UNION` and `EXCEPT`: `a UNION b INTERSECT c` means `a UNION (b INTERSECT c)`. Use parentheses.
- NULLs compare as equal, so a `(NULL)` row on both sides is kept.

## Visual explanation

```text
 customers.country     suppliers.country
   +-----------+---------+-----------+
   | 9 only    |   12    |  4 only   |
   | customers | INTERSECT| suppliers |
   +-----------+---------+-----------+
```

## Common mistakes

- Expecting extra columns: every selected column takes part in the match. Select only the key, then join back for details.
- Forgetting that plain `INTERSECT` removes duplicates.
- Mixing with `UNION` without parentheses and getting the wrong precedence.

## Performance

PostgreSQL runs `INTERSECT` with a hash or sort over both inputs. For a key overlap with indexed columns, `EXISTS` or a semi-join is often faster because it can use an index and stop at the first match.

## Interview questions

### How can you write INTERSECT without INTERSECT?

Use `WHERE EXISTS (...)` with a correlated match, or `INNER JOIN` on all columns plus `DISTINCT`. The JOIN version does not match NULLs.

### What does INTERSECT ALL return?

Each common row min(m, n) times, where m and n are its counts on each side.

### What is the precedence of INTERSECT?

Higher than `UNION` and `EXCEPT`. Use parentheses to make intent clear.

## Quick revision

- `INTERSECT` = rows in both results, distinct.
- `INTERSECT ALL` = keep min(m, n) copies.
- Compares all selected columns; NULLs match NULLs.
- Binds tighter than `UNION` / `EXCEPT`.
- Rewrite with `EXISTS` when you need more columns.
