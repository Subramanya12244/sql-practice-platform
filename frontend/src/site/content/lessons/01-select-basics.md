---
title: SQL SELECT Basics
slug: select-basics
order: 1
level: Beginner
description: Learn the SQL SELECT statement on the Northwind database: choosing columns, aliases, expressions, and reading rows from a table.
related: [q01-product-revenue, q80-product-and-category-name-list, q42-products-and-suppliers]
---

`SELECT` is how you read data. You name the columns you want, the table they come from, and the database returns a result set: a table of rows. Every other lesson builds on this statement.

## Syntax

```sql
SELECT column1, column2 AS alias, expression AS alias
FROM table_name;
```

- `SELECT *` returns every column. Handy for exploring, avoid it in real queries.
- `AS` gives a column a new name in the output. The `AS` keyword is optional but clearer.
- Expressions (`unit_price * 1.1`, `first_name || ' ' || last_name`) compute new columns.

## Examples

**All columns of a small table:**

```sql
SELECT * FROM shippers;
```

**Pick columns and rename them:**

```sql
SELECT product_name AS name, unit_price AS price
FROM products;
```

**Computed column:** value of stock on hand per product.

```sql
SELECT product_name,
       unit_price,
       units_in_stock,
       unit_price * units_in_stock AS stock_value
FROM products;
```

## Common mistakes

- Forgetting commas between columns: `SELECT product_name unit_price` silently treats `unit_price` as an alias.
- Using double quotes for strings. In PostgreSQL `"x"` is an identifier; strings use single quotes `'x'`.
- Assuming rows come back in a fixed order. Without `ORDER BY` the order is not guaranteed.

## Exercises

```exercise
prompt: Return the company name and phone of every shipper.
---
SELECT company_name, phone FROM shippers;
```

```exercise
prompt: List every employee's first name, last name and title.
---
SELECT first_name, last_name, title FROM employees;
```

```exercise
prompt: For every product show product_name and a column full_price_x10 equal to unit_price times 10.
---
SELECT product_name, unit_price * 10 AS full_price_x10 FROM products;
```
