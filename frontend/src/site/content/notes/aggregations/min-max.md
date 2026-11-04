---
title: MIN and MAX
slug: min-max
category: aggregations
difficulty: Beginner
description: Find smallest and largest values with SQL MIN and MAX on numbers, dates and text, plus tie-safe ways to return the row that holds the max.
prerequisites: [select, group-by]
related: [avg, group-by, scalar-subqueries, row-number, first-value]
questions: [22, 26, 50, 113, 119, 129]
patterns: [latest-record-per-group, earliest-latest-transactions, second-highest]
guides: [aggregate-functions, second-highest-value]
minutes: 7
version: 1
---

## Introduction

`MIN` and `MAX` return the extremes of a column. They work on numbers, dates and strings, and they are the core of "latest order" and "top performer" questions.

## Definition

`MIN(expr)` and `MAX(expr)` return the smallest and largest non-NULL value in a group. With no non-NULL values they return NULL.

## Why it matters

First and last order dates, highest price, cheapest product and tie-safe "best customer" queries all use them.

## How it works

The values are compared with the type's ordering: numeric order for numbers, chronological for dates, collation order for text. NULLs are ignored. The result is a value, not a row: `MAX` does not tell you which row held it.

## Syntax

```sql-syntax
SELECT MIN(column_name), MAX(column_name) FROM table_name;
SELECT group_col, MAX(column_name) FROM table_name GROUP BY group_col;
```

## Simple examples

Cheapest and most expensive product:

```sql
SELECT MIN(unit_price) AS cheapest, MAX(unit_price) AS priciest FROM products;
```

Order date range:

```sql
SELECT MIN(order_date) AS first_order, MAX(order_date) AS last_order FROM orders;
```

## Intermediate examples

Latest order date per customer, with customers who never ordered last:

```sql
SELECT c.customer_id, MAX(o.order_date) AS last_order
FROM customers c
LEFT JOIN orders o ON o.customer_id = c.customer_id
GROUP BY c.customer_id
ORDER BY last_order DESC NULLS LAST, c.customer_id
LIMIT 5;
```

Price range per category:

```sql
SELECT category_id,
       MIN(unit_price) AS min_price,
       MAX(unit_price) AS max_price,
       MAX(unit_price) - MIN(unit_price) AS spread
FROM products
GROUP BY category_id
ORDER BY category_id;
```

## Advanced examples

Return the product row(s) with the highest price. Comparing to `MAX` keeps ties; `ORDER BY ... LIMIT 1` would drop them.

```sql
SELECT product_id, product_name, unit_price
FROM products
WHERE unit_price = (SELECT MAX(unit_price) FROM products);
```

Tie-safe top customer by revenue:

```sql
WITH cust AS (
  SELECT o.customer_id,
         SUM(od.unit_price * od.quantity * (1 - od.discount))::numeric AS revenue
  FROM orders o
  JOIN order_details od ON od.order_id = o.order_id
  GROUP BY o.customer_id
)
SELECT customer_id, ROUND(revenue, 2) AS revenue
FROM cust
WHERE revenue = (SELECT MAX(revenue) FROM cust);
```

Second-highest price: the max of everything below the max.

```sql
SELECT MAX(unit_price) AS second_highest
FROM products
WHERE unit_price < (SELECT MAX(unit_price) FROM products);
```

## Real-world scenarios

- Last activity date per customer for churn reports.
- First order month per customer for cohorts.
- Highest sale per employee, with ties kept.

## PostgreSQL specifics

- PostgreSQL also has `GREATEST(a, b, ...)` and `LEAST(a, b, ...)` for comparing values across columns in one row; they ignore NULLs, unlike in some other databases.
- `MIN`/`MAX` on text follow the column collation.
- PostgreSQL can answer `MIN`/`MAX` from a B-tree index without scanning the table.
- `bool_and` / `bool_or` are the boolean equivalents.

## Visual explanation

```text
order_date values for one customer (illustrative):  2024-03-02, 2024-11-18, 2025-06-09
MIN -> 2024-03-02   MAX -> 2025-06-09
customer FISSA (no orders)  -> MAX = NULL
```

## Common mistakes

- Selecting other columns next to `MAX` without grouping, expecting "the row with the max".
- Using `LIMIT 1` when ties must be returned.
- Forgetting `NULLS LAST` when sorting a `MAX` that can be NULL; in PostgreSQL NULLs sort first in `DESC` order.

## Performance

- An index on the column makes ungrouped `MIN`/`MAX` nearly instant in PostgreSQL.
- For "row with max per group" on big tables, `DISTINCT ON` or `ROW_NUMBER()` is usually simpler than a join back to a grouped max.

## Interview questions

### How do you get the row that has the maximum value?

Filter with `WHERE col = (SELECT MAX(col) FROM t)`, which keeps ties, or rank with a window function.

### Do MIN and MAX ignore NULLs?

Yes. They return NULL only when every value is NULL or there are no rows.

### How do you find the second-highest value?

`SELECT MAX(x) FROM t WHERE x < (SELECT MAX(x) FROM t)`, or `DENSE_RANK() = 2`.

### What is the difference between MAX and GREATEST?

`MAX` aggregates down rows. `GREATEST` compares several expressions inside one row.

## Quick revision

- `MIN`/`MAX` work on numbers, dates and text.
- NULLs are ignored.
- They return a value, not the row.
- Compare to a subquery `MAX` to keep ties.
- `GREATEST`/`LEAST` compare across columns.
- In PostgreSQL, `DESC` puts NULLs first; add `NULLS LAST`.
