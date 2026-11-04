---
title: Working with NULL in SQL
slug: nulls
order: 4
level: Beginner
description: Understand SQL NULL: IS NULL, IS DISTINCT FROM, COALESCE and NULLIF, plus how NULL affects comparisons and aggregates in Northwind.
related: [q61-employees-without-a-manager, q114-unshipped-orders-older-than-30-days, q28-customers-with-no-orders]
---

`NULL` means "unknown" or "missing". It is not zero and not an empty string. Any comparison with `NULL` yields `NULL` (not true), so such rows are filtered out by `WHERE`.

## Syntax

```sql
WHERE col IS NULL
WHERE col IS NOT NULL
WHERE a IS DISTINCT FROM b      -- NULL-safe <>
COALESCE(a, b, c)               -- first non-NULL argument
NULLIF(a, b)                    -- NULL if a = b, else a
```

## Examples

**Orders not shipped yet:**

```sql
SELECT order_id, order_date
FROM orders
WHERE shipped_date IS NULL;
```

**Replace missing values for display:**

```sql
SELECT company_name, COALESCE(region, 'n/a') AS region
FROM customers;
```

**Avoid division by zero with NULLIF:**

```sql
SELECT product_name,
       units_on_order / NULLIF(units_in_stock, 0)::numeric AS order_to_stock
FROM products;
```

## Common mistakes

- `WHERE col = NULL` or `col <> NULL`: always unknown, returns nothing.
- `NOT IN (subquery)` returns no rows if the subquery contains a `NULL`. Prefer `NOT EXISTS`.
- `COUNT(col)` skips NULLs, `COUNT(*)` does not.
- `'abc' || NULL` is `NULL`. Wrap nullable parts in `COALESCE` or use `concat()`.

## Exercises

```exercise
prompt: Find the employee(s) who do not report to anyone. Return first_name and last_name.
---
SELECT first_name, last_name FROM employees WHERE reports_to IS NULL;
```

```exercise
prompt: List order_id and shipped_date for every order, showing order_date instead when shipped_date is missing. Name the column ship_or_order_date.
---
SELECT order_id, COALESCE(shipped_date, order_date) AS ship_or_order_date FROM orders;
```

```exercise
prompt: Count how many orders have not been shipped. Return one column unshipped.
---
SELECT COUNT(*) AS unshipped FROM orders WHERE shipped_date IS NULL;
```
