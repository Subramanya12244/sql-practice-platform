---
title: SQL GROUP BY and HAVING
slug: group-by-having
order: 6
level: Beginner
description: Group rows with SQL GROUP BY and filter groups with HAVING; learn WHERE vs HAVING with Northwind customer, product and category examples.
related: [q02-category-revenue, q35-categories-and-number-of-products, q36-suppliers-and-number-of-products, q110-orders-per-year-and-month]
---

`GROUP BY` splits rows into groups that share the same values, then aggregates run once per group. `HAVING` filters groups after aggregation, the way `WHERE` filters rows before it.

## Syntax

```sql
SELECT group_col, AGG(x)
FROM t
WHERE row_condition
GROUP BY group_col
HAVING group_condition
ORDER BY ...;
```

Logical order: `FROM` then `WHERE` then `GROUP BY` then `HAVING` then `SELECT` then `ORDER BY` then `LIMIT`.

## Examples

**Customers per country:**

```sql
SELECT country, COUNT(*) AS customers
FROM customers
GROUP BY country
ORDER BY customers DESC, country;
```

**Products per category with average price:**

```sql
SELECT c.category_name, COUNT(*) AS products, ROUND(AVG(p.unit_price), 2) AS avg_price
FROM products p
JOIN categories c ON c.category_id = p.category_id
GROUP BY c.category_name;
```

**HAVING: suppliers with at least 4 products:**

```sql
SELECT supplier_id, COUNT(*) AS products
FROM products
GROUP BY supplier_id
HAVING COUNT(*) >= 4;
```

## Common mistakes

- Selecting a column that is neither grouped nor aggregated: `column must appear in the GROUP BY clause`.
- Putting aggregate conditions in `WHERE`. `WHERE COUNT(*) > 1` is invalid; use `HAVING`.
- Filtering in `HAVING` what could be filtered in `WHERE`; it works but processes more rows.

## Exercises

```exercise
prompt: Count customers per country. Return country and customer_count, sorted by customer_count descending then country.
orderBy: customer_count DESC, country
---
SELECT country, COUNT(*) AS customer_count FROM customers GROUP BY country ORDER BY customer_count DESC, country;
```

```exercise
prompt: Show countries with more than 5 customers. Return country and customer_count.
---
SELECT country, COUNT(*) AS customer_count FROM customers GROUP BY country HAVING COUNT(*) > 5;
```

```exercise
prompt: For each order compute total quantity of items. Return order_id and total_qty for orders with total_qty over 100.
---
SELECT order_id, SUM(quantity) AS total_qty FROM order_details GROUP BY order_id HAVING SUM(quantity) > 100;
```
