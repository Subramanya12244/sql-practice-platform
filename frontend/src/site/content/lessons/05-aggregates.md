---
title: SQL Aggregate Functions
slug: aggregates
order: 5
level: Beginner
description: Summarize data with SQL aggregate functions COUNT, SUM, AVG, MIN, MAX, COUNT DISTINCT and FILTER, using Northwind sales examples.
related: [q86-entity-record-count-summary, q01-product-revenue, q40-customers-and-average-order-value]
---

Aggregate functions collapse many rows into one value. Without `GROUP BY` they summarize the whole table (or the rows left after `WHERE`).

## Syntax

```sql
SELECT COUNT(*), COUNT(col), COUNT(DISTINCT col),
       SUM(col), AVG(col), MIN(col), MAX(col),
       COUNT(*) FILTER (WHERE condition)
FROM t;
```

## Examples

**Basic stats on products:**

```sql
SELECT COUNT(*) AS products,
       MIN(unit_price) AS cheapest,
       MAX(unit_price) AS priciest,
       ROUND(AVG(unit_price), 2) AS avg_price
FROM products;
```

**Total net revenue across all order lines:**

```sql
SELECT ROUND(SUM(unit_price * quantity * (1 - discount))::numeric, 2) AS revenue
FROM order_details;
```

**Conditional counts with FILTER:**

```sql
SELECT COUNT(*) AS orders,
       COUNT(*) FILTER (WHERE shipped_date IS NULL) AS unshipped,
       COUNT(DISTINCT customer_id) AS customers
FROM orders;
```

## Common mistakes

- Mixing aggregates and plain columns without `GROUP BY` is an error.
- `AVG` of an integer column returns numeric in PostgreSQL, but integer division `SUM(a)/COUNT(*)` truncates.
- `discount` is `real`; cast to `numeric` before `ROUND(x, 2)`.
- Aggregates ignore NULLs (except `COUNT(*)`); `SUM` of zero rows is `NULL`, not `0`.

## Exercises

```exercise
prompt: How many customers are there in total? Return one column customer_count.
---
SELECT COUNT(*) AS customer_count FROM customers;
```

```exercise
prompt: Return the minimum, maximum and average freight across all orders (columns min_freight, max_freight, avg_freight, avg rounded to 2 decimals).
---
SELECT MIN(freight) AS min_freight, MAX(freight) AS max_freight, ROUND(AVG(freight), 2) AS avg_freight FROM orders;
```

```exercise
prompt: Count how many distinct products have ever been ordered. Return distinct_products.
---
SELECT COUNT(DISTINCT product_id) AS distinct_products FROM order_details;
```
