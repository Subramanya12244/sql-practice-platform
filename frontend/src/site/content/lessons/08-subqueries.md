---
title: SQL Subqueries
slug: subqueries
order: 8
level: Intermediate
description: Learn SQL subqueries on Northwind: scalar subqueries, IN, EXISTS and NOT EXISTS, and correlated subqueries, with pitfalls like NOT IN and NULL.
related: [q06-customers-above-average-revenue, q15-customers-above-average-orders-correlated-subquery, q16-customers-above-average-revenue-correlated-subquery, q29-products-never-ordered]
---

A subquery is a `SELECT` nested inside another statement. It can return a single value (scalar), a list (used with `IN`), or be tested for existence (`EXISTS`). A correlated subquery references columns of the outer query and is evaluated per outer row.

## Syntax

```sql
-- scalar
WHERE x > (SELECT AVG(x) FROM t)
-- list
WHERE id IN (SELECT id FROM t2 WHERE ...)
-- existence
WHERE EXISTS (SELECT 1 FROM t2 WHERE t2.fk = t1.id)
-- correlated
WHERE x > (SELECT AVG(x) FROM t t2 WHERE t2.grp = t1.grp)
```

## Examples

**Scalar: products priced above average:**

```sql
SELECT product_name, unit_price
FROM products
WHERE unit_price > (SELECT AVG(unit_price) FROM products);
```

**EXISTS: customers who ordered at least once:**

```sql
SELECT c.company_name
FROM customers c
WHERE EXISTS (SELECT 1 FROM orders o WHERE o.customer_id = c.customer_id);
```

**Correlated: products above their own category's average price:**

```sql
SELECT p.product_name, p.category_id, p.unit_price
FROM products p
WHERE p.unit_price > (
    SELECT AVG(p2.unit_price) FROM products p2 WHERE p2.category_id = p.category_id
);
```

## Common mistakes

- A scalar subquery returning more than one row raises an error.
- `NOT IN (SELECT col ...)` returns nothing if `col` has any NULL. Use `NOT EXISTS`.
- Correlated subqueries can be slow on large tables; a join plus `GROUP BY` or a window function is often faster.

## Exercises

```exercise
prompt: List product_name and unit_price for products priced above the average product price.
---
SELECT product_name, unit_price FROM products WHERE unit_price > (SELECT AVG(unit_price) FROM products);
```

```exercise
prompt: Find customers who have never placed an order using NOT EXISTS. Return customer_id and company_name.
---
SELECT c.customer_id, c.company_name FROM customers c WHERE NOT EXISTS (SELECT 1 FROM orders o WHERE o.customer_id = c.customer_id);
```

```exercise
prompt: List the company names of suppliers that supply at least one product in the 'Beverages' category, using IN.
---
SELECT company_name FROM suppliers WHERE supplier_id IN (SELECT p.supplier_id FROM products p JOIN categories c ON c.category_id = p.category_id WHERE c.category_name = 'Beverages');
```

```exercise
prompt: Using a correlated subquery, list products whose unit_price is the highest in their category. Return category_id, product_name, unit_price.
---
SELECT p.category_id, p.product_name, p.unit_price FROM products p WHERE p.unit_price = (SELECT MAX(p2.unit_price) FROM products p2 WHERE p2.category_id = p.category_id);
```
