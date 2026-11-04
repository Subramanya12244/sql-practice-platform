---
title: Scalar subqueries
slug: scalar-subqueries
category: subqueries
difficulty: Intermediate
description: Scalar subqueries return one value you can use anywhere an expression fits, such as comparing rows to an overall average.
prerequisites: [select, where, avg]
related: [correlated-subqueries, cte, cte-vs-subquery, having]
questions: [6, 7, 8, 96]
patterns: [second-highest]
guides: [second-highest-value]
minutes: 7
version: 1
---

## Introduction

Many questions compare each row to one number: "products above the average price" or "the most recent order date". A scalar subquery works out that number inside the query itself.

## Definition

A scalar subquery is a `SELECT` in parentheses that returns at most one row and one column. SQL treats its result as a single value. If it returns no rows, the value is NULL. If it returns more than one row, the query fails.

## Why it matters

- It avoids hard-coding values such as `WHERE unit_price > 28.87`.
- "Above average" interview questions use it all the time.
- It is the simplest kind of subquery and the basis for understanding correlated subqueries.

## How it works

A non-correlated scalar subquery does not reference the outer query, so PostgreSQL runs it once and reuses the value for every outer row (an `InitPlan` in `EXPLAIN`).

## Syntax

```sql-syntax
SELECT col, (SELECT agg(x) FROM other_table) AS label
FROM table_name
WHERE col > (SELECT agg(col) FROM table_name);
```

## Simple examples

Products priced above the average price:

```sql
SELECT product_name, unit_price
FROM products
WHERE unit_price > (SELECT AVG(unit_price) FROM products)
ORDER BY unit_price DESC;
```

Show the overall average next to each row:

```sql
SELECT product_name, unit_price,
       ROUND((SELECT AVG(unit_price) FROM products), 2) AS avg_price
FROM products
ORDER BY product_id
LIMIT 5;
```

## Intermediate examples

Second-highest price. The subquery finds the maximum, and the outer query finds the largest value below it:

```sql
SELECT MAX(unit_price) AS second_highest
FROM products
WHERE unit_price < (SELECT MAX(unit_price) FROM products);
```

Each order's freight as a percentage of total freight:

```sql
SELECT order_id, freight,
       ROUND(100 * freight / (SELECT SUM(freight) FROM orders), 2) AS pct_of_total
FROM orders
ORDER BY freight DESC
LIMIT 5;
```

## Advanced examples

A scalar subquery inside `HAVING`: customers whose order count is above the average order count per customer:

```sql
SELECT customer_id, COUNT(*) AS orders
FROM orders
GROUP BY customer_id
HAVING COUNT(*) > (
  SELECT AVG(cnt) FROM (
    SELECT COUNT(*) AS cnt FROM orders GROUP BY customer_id
  ) t
)
ORDER BY orders DESC;
```

## Real-world scenarios

- Compare sales to a company-wide KPI, such as "reps above average revenue".
- Show each value as a percentage of a grand total.
- Look up a single configuration value or the latest date.

## PostgreSQL specifics

- A scalar subquery that returns more than one row raises `ERROR: more than one row returned by a subquery used as an expression`.
- If it returns no rows, the result is NULL, so a comparison with it is never true.
- `AVG` over an `integer` column returns `numeric` in PostgreSQL, so you get no integer truncation.

## Visual explanation

```text
(SELECT AVG(unit_price) FROM products)  ->  28.87   (computed once)
                                             |
products row 1: 18.00 > 28.87 ? no           |
products row 2: 19.00 > 28.87 ? no           |
products row 9: 97.00 > 28.87 ? yes  <-------+
```

## Common mistakes

- Returning several rows, such as `(SELECT unit_price FROM products WHERE category_id = 1)`, where a single value is expected. Use `IN` or an aggregate instead.
- Writing `WHERE unit_price > AVG(unit_price)`. Aggregates are not allowed in `WHERE`, so put the aggregate in a subquery.
- Forgetting that an empty result is NULL, which silently filters out every row.

## Performance

A non-correlated scalar subquery runs once, so it is cheap. Repeating the same subquery in several places can mean extra scans. A CTE or a `CROSS JOIN` to a one-row derived table computes the value once and names it.

## Interview questions

### What happens if a scalar subquery returns two rows?

The query fails at runtime with "more than one row returned by a subquery used as an expression".

### Why can't you write `WHERE price > AVG(price)`?

`WHERE` filters rows before grouping, so aggregates are not available there. Compute the average in a scalar subquery, or use a window function.

### How do you find the second-highest value with a subquery?

`SELECT MAX(x) FROM t WHERE x < (SELECT MAX(x) FROM t)`. This handles ties at the top.

### Does a scalar subquery run once per row?

Only when it is correlated. A non-correlated one runs once.

## Quick revision

- Returns one row and one column, so it is used like a value.
- No rows gives NULL. More than one row gives an error.
- It can appear in `SELECT`, `WHERE`, `HAVING` and `ORDER BY`.
- Non-correlated subqueries run once (an InitPlan).
- It is the standard tool for "above average" questions.
