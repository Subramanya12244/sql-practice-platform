---
title: SQL Set Operations UNION, INTERSECT, EXCEPT
slug: set-operations
order: 10
level: Intermediate
description: Combine query results with SQL UNION, UNION ALL, INTERSECT and EXCEPT; learn the column rules and build Northwind contact directories.
related: [q79-customer-and-supplier-contact-directory, q81-company-name-directory, q82-contact-directory-with-type-label, q85-master-location-directory]
---

Set operations stack the results of two queries vertically. Both queries must return the same number of columns with compatible types; column names come from the first query.

| Operator | Result |
|---|---|
| `UNION` | rows in either, duplicates removed |
| `UNION ALL` | rows in either, duplicates kept (faster) |
| `INTERSECT` | rows in both |
| `EXCEPT` | rows in the first but not the second |

## Syntax

```sql
SELECT a, b FROM t1
UNION [ALL] | INTERSECT | EXCEPT
SELECT a, b FROM t2
ORDER BY a;   -- applies to the combined result
```

## Examples

**Contact directory with a type label:**

```sql
SELECT contact_name, company_name, 'Customer' AS type FROM customers
UNION ALL
SELECT contact_name, company_name, 'Supplier' FROM suppliers
ORDER BY type, company_name;
```

**Countries with both customers and suppliers:**

```sql
SELECT country FROM customers
INTERSECT
SELECT country FROM suppliers;
```

**Countries with customers but no suppliers:**

```sql
SELECT country FROM customers
EXCEPT
SELECT country FROM suppliers;
```

## Common mistakes

- Column count or type mismatch between the two queries.
- Using `UNION` when `UNION ALL` is intended, losing legitimate duplicate rows.
- Putting `ORDER BY` inside the first query; it belongs at the end.

## Exercises

```exercise
prompt: Return a single list of all distinct cities where customers or suppliers are located (column city).
---
SELECT city FROM customers UNION SELECT city FROM suppliers;
```

```exercise
prompt: List countries that have both customers and suppliers.
---
SELECT country FROM customers INTERSECT SELECT country FROM suppliers;
```

```exercise
prompt: List countries that have customers but no suppliers.
---
SELECT country FROM customers EXCEPT SELECT country FROM suppliers;
```
