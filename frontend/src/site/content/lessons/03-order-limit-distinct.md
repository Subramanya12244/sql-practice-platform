---
title: SQL ORDER BY, LIMIT, OFFSET and DISTINCT
slug: order-limit-distinct
order: 3
level: Beginner
description: Sort results with SQL ORDER BY, page with LIMIT and OFFSET, and remove duplicates with DISTINCT and DISTINCT ON, using Northwind data.
related: [q03-top-10-customers-by-revenue, q05-top-5-customers-by-number-of-orders, q148-rank-vs-dense-rank-product-prices, q147-latest-order-per-customer]
---

Rows have no natural order. `ORDER BY` defines one, `LIMIT`/`OFFSET` take a slice of it, and `DISTINCT` drops duplicate rows.

## Syntax

```sql
SELECT DISTINCT col1, col2
FROM t
ORDER BY col1 DESC, col2 ASC
LIMIT 10 OFFSET 20;
```

- `ASC` is the default. In PostgreSQL NULLs sort last in `ASC` and first in `DESC`; override with `NULLS FIRST` / `NULLS LAST`.
- You can order by a column alias or position (`ORDER BY 2`), though names are clearer.
- `DISTINCT ON (expr)` (PostgreSQL) keeps the first row per group according to `ORDER BY`.

## Examples

**Top 5 most expensive products:**

```sql
SELECT product_name, unit_price
FROM products
ORDER BY unit_price DESC, product_name
LIMIT 5;
```

**Second page of 10 customers:**

```sql
SELECT customer_id, company_name
FROM customers
ORDER BY customer_id
LIMIT 10 OFFSET 10;
```

**Distinct countries, and the cheapest product per category:**

```sql
SELECT DISTINCT country FROM customers ORDER BY country;

SELECT DISTINCT ON (category_id) category_id, product_name, unit_price
FROM products
ORDER BY category_id, unit_price, product_name;
```

## Common mistakes

- `LIMIT` without `ORDER BY` returns arbitrary rows.
- Ties: if two rows share the sort key, `LIMIT` may cut between them unpredictably. Add a tie-breaker column.
- `DISTINCT` applies to the whole row, not just the first column.
- Large `OFFSET` values are slow: the database still reads all the skipped rows.

## Exercises

```exercise
prompt: List the 5 most expensive products with their unit price.
orderBy: unit_price DESC, product_name
---
SELECT product_name, unit_price FROM products ORDER BY unit_price DESC, product_name LIMIT 5;
```

```exercise
prompt: Return each distinct country that has at least one supplier, sorted alphabetically.
orderBy: country
---
SELECT DISTINCT country FROM suppliers ORDER BY country;
```

```exercise
prompt: Show products 11 to 20 when products are sorted by product_name. Return product_id and product_name.
orderBy: product_name
---
SELECT product_id, product_name FROM products ORDER BY product_name LIMIT 10 OFFSET 10;
```
