---
title: EXISTS and NOT EXISTS
slug: exists-not-exists
category: subqueries
difficulty: Intermediate
description: EXISTS tests whether a subquery finds any row; NOT EXISTS is the NULL-safe way to find unmatched records like customers without orders.
prerequisites: [correlated-subqueries, where]
related: [in-not-in, left-join, join-vs-subquery, except]
questions: [28, 29, 30, 61]
patterns: [anti-join, customers-without-orders, unmatched-records, missing-records]
guides: [exists-vs-in]
minutes: 7
version: 1
---

## Introduction

"Which customers have never ordered?" and "which products were sold at least once?" are questions about whether a match exists. `EXISTS` answers them directly.

## Definition

`EXISTS (subquery)` is true if the subquery returns at least one row. `NOT EXISTS` is true if it returns no rows. The values the subquery returns are ignored.

## Why it matters

- It is the safest way to write an anti-join. Unlike `NOT IN`, it is not affected by NULLs.
- It never duplicates outer rows, unlike a JOIN to a one-to-many table.
- It is one of the most common interview topics: "customers without orders".

## How it works

The subquery is correlated to the outer row. The database stops at the first matching row, so this is a semi-join for `EXISTS` and an anti-join for `NOT EXISTS`.

## Syntax

```sql-syntax
SELECT ... FROM a
WHERE [NOT] EXISTS (SELECT 1 FROM b WHERE b.key = a.key);
```

## Simple examples

Customers with no orders (FISSA and PARIS):

```sql
SELECT c.customer_id, c.company_name
FROM customers c
WHERE NOT EXISTS (SELECT 1 FROM orders o WHERE o.customer_id = c.customer_id);
```

Products that were ordered at least once:

```sql
SELECT p.product_id, p.product_name
FROM products p
WHERE EXISTS (SELECT 1 FROM order_details od WHERE od.product_id = p.product_id)
ORDER BY p.product_id
LIMIT 5;
```

## Intermediate examples

Products never ordered (products 9 and 17):

```sql
SELECT p.product_id, p.product_name
FROM products p
WHERE NOT EXISTS (SELECT 1 FROM order_details od WHERE od.product_id = p.product_id);
```

Employees who manage someone:

```sql
SELECT m.employee_id, m.first_name, m.last_name
FROM employees m
WHERE EXISTS (SELECT 1 FROM employees e WHERE e.reports_to = m.employee_id);
```

## Advanced examples

Extra conditions inside the subquery. These are customers who bought a Beverages product (category 1) but never a Seafood product (category 8):

```sql
SELECT c.customer_id
FROM customers c
WHERE EXISTS (SELECT 1 FROM orders o
              JOIN order_details od ON od.order_id = o.order_id
              JOIN products p ON p.product_id = od.product_id
              WHERE o.customer_id = c.customer_id AND p.category_id = 1)
  AND NOT EXISTS (SELECT 1 FROM orders o
                  JOIN order_details od ON od.order_id = o.order_id
                  JOIN products p ON p.product_id = od.product_id
                  WHERE o.customer_id = c.customer_id AND p.category_id = 8)
ORDER BY c.customer_id;
```

The equivalent `LEFT JOIN ... IS NULL` anti-join:

```sql
SELECT c.customer_id
FROM customers c
LEFT JOIN orders o ON o.customer_id = c.customer_id
WHERE o.order_id IS NULL;
```

## Real-world scenarios

- Inactive customers and churn lists.
- Products with no sales, so they can be discontinued.
- Data-quality checks, such as rows in a child table whose parent is missing.

## PostgreSQL specifics

- The planner turns `EXISTS` into a Semi Join and `NOT EXISTS` into an Anti Join, so it usually performs the same as `LEFT JOIN ... IS NULL`.
- `SELECT 1`, `SELECT *` and `SELECT NULL` inside `EXISTS` behave the same. The select list is never evaluated.

## Visual explanation

```text
customers        orders(customer_id)
ALFKI  ---------> ALFKI, ALFKI ...   EXISTS true   -> NOT EXISTS false
FISSA  ---------> (none)             EXISTS false  -> NOT EXISTS true  -> returned
PARIS  ---------> (none)             EXISTS false  -> NOT EXISTS true  -> returned
```

## Common mistakes

- Forgetting the correlation (`WHERE o.customer_id = c.customer_id`). Without it, `EXISTS` is true for every row as soon as `orders` has any row.
- Using `NOT IN` when the subquery can return NULL, which returns zero rows. Use `NOT EXISTS`.
- Putting a filter in the outer `WHERE` that belongs inside the subquery, such as a date range.

## Performance

`EXISTS` stops at the first match. An index on the inner correlation column, such as `order_details(product_id)`, lets each probe be an index lookup. With hash anti-joins, the cost is about the same as `LEFT JOIN / IS NULL`.

## Interview questions

### Why prefer NOT EXISTS over NOT IN?

If the subquery returns any NULL, `NOT IN` evaluates to UNKNOWN for every row and returns nothing. `NOT EXISTS` only checks whether a row exists, so NULLs do not matter.

### Does it matter what you select inside EXISTS?

No. Only whether a row exists matters. `SELECT 1` is the usual convention.

### EXISTS vs INNER JOIN?

`EXISTS` returns each outer row at most once. A JOIN repeats it for every match and needs `DISTINCT` to remove duplicates.

### Name three ways to find customers without orders.

`NOT EXISTS`, `LEFT JOIN ... WHERE o.order_id IS NULL`, and `EXCEPT` on the key columns.

## Quick revision

- `EXISTS` is true when at least one row exists. The selected values are ignored.
- `NOT EXISTS` is the NULL-safe anti-join.
- Always correlate the subquery to the outer row.
- It never duplicates outer rows.
- PostgreSQL plans it as a Semi Join or an Anti Join.
- Index the inner join column.
