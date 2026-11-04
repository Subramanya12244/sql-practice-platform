---
slug: correlated-subquery
title: SQL Correlated Subquery Explained with Examples
description: Understand SQL correlated subqueries with Northwind examples: how they run per row, correlated vs non-correlated, EXISTS, performance, and CTE alternatives.
keywords: sql correlated subquery, correlated vs non correlated subquery, exists subquery, subquery per row, sql subquery example
questions: 13, 15, 16, 17, 18
related: cte, group-by-having, left-join
---

A correlated subquery is a subquery that references a column from the outer query, so it is logically re-evaluated for each outer row. That makes it a natural fit for "compare this row to its own group" questions, such as products priced above their category's average. A non-correlated subquery, by contrast, runs once and returns the same value for every row.

## Syntax

```sql
SELECT outer_cols
FROM table_a a
WHERE a.value > (
    SELECT AGG(b.value)
    FROM table_b b
    WHERE b.group_key = a.group_key   -- reference to the outer row
);

-- Existence check
SELECT ... FROM table_a a
WHERE EXISTS (SELECT 1 FROM table_b b WHERE b.key = a.key);
```

## Example

**Business question:** Which products are priced above the average price of their own category?

```sql
SELECT p.product_name,
       p.category_id,
       p.unit_price
FROM products p
WHERE p.unit_price > (
    SELECT AVG(p2.unit_price)
    FROM products p2
    WHERE p2.category_id = p.category_id
)
ORDER BY p.category_id, p.unit_price DESC;
```

Illustrative result:

| product_name | category_id | unit_price |
|---|---|---|
| Côte de Blaye | 1 | 263.50 |
| Ipoh Coffee | 1 | 46.00 |
| Vegie-spread | 2 | 43.90 |

## How it works

For each row of `products p`, the inner query filters `p2` to the same `category_id` and computes that category's average. The outer `WHERE` keeps the row only if its price beats that number. The alias `p` inside the subquery is what makes it correlated; remove `WHERE p2.category_id = p.category_id` and it becomes a single global average.

PostgreSQL's planner may not literally execute the subquery once per row — it can cache or transform it — but you should reason about it that way.

A harder variant compares an aggregate with a group-level average: which customers bring an employee more revenue than that employee's average customer?

```sql
WITH cust_emp AS (
    SELECT o.employee_id, o.customer_id,
           SUM(od.unit_price * od.quantity * (1 - od.discount)) AS revenue
    FROM orders o
    JOIN order_details od ON od.order_id = o.order_id
    GROUP BY o.employee_id, o.customer_id
)
SELECT ce.employee_id, ce.customer_id, ROUND(ce.revenue::numeric, 2) AS revenue
FROM cust_emp ce
WHERE ce.revenue > (
    SELECT AVG(x.revenue)
    FROM cust_emp x
    WHERE x.employee_id = ce.employee_id
)
ORDER BY ce.employee_id, revenue DESC;
```

Each customer-employee pair is compared with the average for that same employee only.

`EXISTS` is the other common correlated form. It stops at the first match and returns true or false, so it never duplicates outer rows:

```sql
SELECT c.customer_id, c.company_name
FROM customers c
WHERE EXISTS (
    SELECT 1 FROM orders o
    WHERE o.customer_id = c.customer_id
      AND o.order_date >= DATE '1998-01-01'
);
```

## Common mistakes

- **Forgetting the correlation.** Without the outer reference, you compare every row to a global value. That is a valid query that answers the wrong question.
- **Ambiguous aliases.** Using `products` in both levels without distinct aliases makes `category_id = category_id` compare the inner table to itself, which is always true. Always alias both levels (`p`, `p2`).
- **Scalar subquery returning many rows.** A subquery used with `>` must return one value. Missing `AVG` or a missing filter causes "more than one row returned by a subquery".
- **Nesting aggregates instead.** `AVG(COUNT(*))` is not allowed. A correlated subquery or a CTE is the way to compare a count to an average of counts.
- **Assuming it is always slow.** Modern planners handle many correlated subqueries well, but on big tables a pre-aggregated CTE or window function is usually safer.

## When to use it vs alternatives

| Approach | Best for | Notes |
|---|---|---|
| Correlated subquery | Per-row comparison to its own group | Readable for one condition |
| CTE + join on group key | Reusing group averages | Computes each group once |
| Window function `AVG(...) OVER (PARTITION BY ...)` | Same result in one pass | Needs an outer query to filter |
| `EXISTS` / `NOT EXISTS` | Semi-join / anti-join | NULL-safe, no duplicates |

Window version of the example:

```sql
SELECT product_name, category_id, unit_price
FROM (
    SELECT p.*, AVG(unit_price) OVER (PARTITION BY category_id) AS cat_avg
    FROM products p
) t
WHERE unit_price > cat_avg;
```

## Interview questions

### What is the difference between a correlated and a non-correlated subquery?
A non-correlated subquery is independent of the outer query and runs once. A correlated subquery references an outer column, so it is evaluated for each outer row. The test is simple: can you run the inner query on its own? If not, it is correlated.

### When would you use EXISTS instead of IN?
Use `EXISTS` when you only need to know whether a matching row exists, especially when the subquery column can contain NULLs. `NOT EXISTS` is NULL-safe, while `NOT IN` returns no rows if the subquery yields any NULL.

### Can a correlated subquery be rewritten as a join?
Usually, yes. Pre-aggregate the inner query by the correlation key in a CTE or derived table, then join it on that key. A window function with `PARTITION BY` is another common rewrite.

### Are correlated subqueries slow?
They can be on large tables if the planner cannot optimize them, since the logic is per row. PostgreSQL often transforms them efficiently, but check with `EXPLAIN`. A pre-aggregated join or a window function is the usual faster alternative.

## Practice

Practice this pattern with the questions below.
