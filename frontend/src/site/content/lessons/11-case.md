---
title: SQL CASE Expressions
slug: case
order: 11
level: Intermediate
description: Add conditional logic to SQL with CASE: searched and simple forms, bucketing values, conditional aggregation and custom sort orders on Northwind.
related: [q82-contact-directory-with-type-label, q155-customer-revenue-quartiles, q161-late-shipments-with-days-late]
---

`CASE` is SQL's if/else. It returns a value, so it can appear anywhere an expression can: `SELECT`, `WHERE`, `ORDER BY`, inside aggregates.

## Syntax

```sql
-- searched form
CASE WHEN condition1 THEN result1
     WHEN condition2 THEN result2
     ELSE default
END

-- simple form
CASE column WHEN value1 THEN result1 ELSE default END
```

Conditions are tested top to bottom; the first true one wins. Without `ELSE` the result is `NULL`.

## Examples

**Price bands:**

```sql
SELECT product_name, unit_price,
       CASE WHEN unit_price < 10 THEN 'Budget'
            WHEN unit_price < 50 THEN 'Standard'
            ELSE 'Premium' END AS price_band
FROM products;
```

**Conditional aggregation (pivot):** shipped vs unshipped per employee.

```sql
SELECT employee_id,
       SUM(CASE WHEN shipped_date IS NOT NULL THEN 1 ELSE 0 END) AS shipped,
       SUM(CASE WHEN shipped_date IS NULL THEN 1 ELSE 0 END) AS pending
FROM orders
GROUP BY employee_id;
```

**Custom sort order:**

```sql
SELECT company_name, country
FROM customers
ORDER BY CASE WHEN country = 'USA' THEN 0 ELSE 1 END, company_name;
```

## Common mistakes

- Branches returning different types (`'text'` vs number) cause a type error.
- Ordering of `WHEN` matters: put the narrowest condition first.
- Forgetting `END`.

## Exercises

```exercise
prompt: Label each product as 'Low' (units_in_stock < 20), 'Medium' (< 50) or 'High' otherwise. Return product_name and stock_level.
---
SELECT product_name, CASE WHEN units_in_stock < 20 THEN 'Low' WHEN units_in_stock < 50 THEN 'Medium' ELSE 'High' END AS stock_level FROM products;
```

```exercise
prompt: For each shipper (ship_via), count orders shipped late (shipped_date > required_date) and on time. Return ship_via, late, on_time.
---
SELECT ship_via, SUM(CASE WHEN shipped_date > required_date THEN 1 ELSE 0 END) AS late, SUM(CASE WHEN shipped_date <= required_date THEN 1 ELSE 0 END) AS on_time FROM orders GROUP BY ship_via;
```

```exercise
prompt: Count products per price band: 'Budget' (< 10), 'Standard' (< 50), 'Premium'. Return price_band and product_count.
---
SELECT CASE WHEN unit_price < 10 THEN 'Budget' WHEN unit_price < 50 THEN 'Standard' ELSE 'Premium' END AS price_band, COUNT(*) AS product_count FROM products GROUP BY 1;
```
