---
title: SQL WHERE Clause and Operators
slug: where-operators
order: 2
level: Beginner
description: Filter rows with SQL WHERE: comparison operators, AND/OR/NOT, IN, BETWEEN, LIKE and ILIKE pattern matching, with Northwind examples.
related: [q66-customers-from-the-same-country, q61-employees-without-a-manager, q163-unshipped-orders-older-than-30-days]
---

`WHERE` keeps only rows for which a condition is true. It runs before grouping and before `SELECT` aliases exist.

## Syntax

```sql
SELECT ...
FROM table_name
WHERE condition;
```

| Operator | Meaning |
|---|---|
| `=`, `<>`, `<`, `<=`, `>`, `>=` | comparison |
| `AND`, `OR`, `NOT` | combine conditions |
| `IN (a, b, c)` | equals any value in the list |
| `BETWEEN a AND b` | inclusive range, `>= a AND <= b` |
| `LIKE 'A%'` | pattern: `%` any characters, `_` one character |
| `ILIKE` | case-insensitive `LIKE` (PostgreSQL) |

## Examples

**Comparison and AND:**

```sql
SELECT product_name, unit_price, units_in_stock
FROM products
WHERE unit_price > 50 AND units_in_stock > 0;
```

**IN list:**

```sql
SELECT company_name, country
FROM customers
WHERE country IN ('Germany', 'France', 'Spain');
```

**BETWEEN and ILIKE:**

```sql
SELECT product_name, unit_price
FROM products
WHERE unit_price BETWEEN 10 AND 20
  AND product_name ILIKE '%cho%';
```

## Common mistakes

- Mixing `AND` and `OR` without parentheses. `AND` binds tighter: `a OR b AND c` means `a OR (b AND c)`.
- `BETWEEN` on dates includes both ends; on timestamps the upper end is only the exact midnight value.
- `= NULL` never matches. Use `IS NULL` (see the NULLs lesson).
- `LIKE` is case-sensitive in PostgreSQL. Use `ILIKE` or `lower()`.

## Exercises

```exercise
prompt: List product_name and unit_price for products priced between 20 and 30 inclusive.
---
SELECT product_name, unit_price FROM products WHERE unit_price BETWEEN 20 AND 30;
```

```exercise
prompt: Find customers (company_name, country) located in the UK or USA.
---
SELECT company_name, country FROM customers WHERE country IN ('UK', 'USA');
```

```exercise
prompt: Find products whose name starts with the letter C (any case). Return product_name.
---
SELECT product_name FROM products WHERE product_name ILIKE 'c%';
```

```exercise
prompt: Show discontinued products that still have units in stock. Return product_name and units_in_stock.
---
SELECT product_name, units_in_stock FROM products WHERE discontinued AND units_in_stock > 0;
```
