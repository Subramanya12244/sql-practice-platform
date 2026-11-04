---
title: SQL Joins Explained
slug: joins
order: 7
level: Intermediate
description: Master SQL joins on Northwind: INNER, LEFT, RIGHT, FULL OUTER, self joins and CROSS JOIN, with examples and the classic mistakes.
related: [q41-customers-and-orders, q28-customers-with-no-orders, q51-customers-and-orders-full-outer-join, q61-employees-without-a-manager, q71-employee-category-combinations]
---

Joins combine rows from two tables based on a condition, usually a foreign key matching a primary key.

| Join | Keeps |
|---|---|
| `INNER JOIN` | only matching pairs |
| `LEFT JOIN` | all left rows, NULLs where no right match |
| `RIGHT JOIN` | all right rows |
| `FULL OUTER JOIN` | all rows from both sides |
| `CROSS JOIN` | every combination (no condition) |
| self join | a table joined to itself under two aliases |

## Syntax

```sql
SELECT a.col, b.col
FROM table_a a
[INNER | LEFT | RIGHT | FULL] JOIN table_b b ON b.key = a.key;
```

## Examples

**Inner join: products with their category:**

```sql
SELECT p.product_name, c.category_name
FROM products p
JOIN categories c ON c.category_id = p.category_id;
```

**Left join to find customers with no orders:**

```sql
SELECT c.customer_id, c.company_name
FROM customers c
LEFT JOIN orders o ON o.customer_id = c.customer_id
WHERE o.order_id IS NULL;
```

**Self join: employee and manager names:**

```sql
SELECT e.first_name || ' ' || e.last_name AS employee,
       m.first_name || ' ' || m.last_name AS manager
FROM employees e
LEFT JOIN employees m ON m.employee_id = e.reports_to;
```

## Common mistakes

- Filtering the right table of a `LEFT JOIN` in `WHERE` (e.g. `WHERE o.ship_country = 'USA'`) turns it into an inner join. Put such filters in `ON`.
- Joining two one-to-many tables then summing causes double counting. Aggregate first.
- Forgetting the `ON` condition produces a Cartesian product.

## Exercises

```exercise
prompt: List each product with its supplier's company name. Return product_name and supplier (company_name).
---
SELECT p.product_name, s.company_name AS supplier FROM products p JOIN suppliers s ON s.supplier_id = p.supplier_id;
```

```exercise
prompt: Find products that have never been ordered. Return product_id and product_name.
---
SELECT p.product_id, p.product_name FROM products p LEFT JOIN order_details od ON od.product_id = p.product_id WHERE od.order_id IS NULL;
```

```exercise
prompt: Show every employee with their manager's last name (NULL if none). Return employee_id, last_name, manager_last_name.
---
SELECT e.employee_id, e.last_name, m.last_name AS manager_last_name FROM employees e LEFT JOIN employees m ON m.employee_id = e.reports_to;
```

```exercise
prompt: Produce every shipper and category combination. Return shipper (company_name) and category_name.
---
SELECT s.company_name AS shipper, c.category_name FROM shippers s CROSS JOIN categories c;
```
