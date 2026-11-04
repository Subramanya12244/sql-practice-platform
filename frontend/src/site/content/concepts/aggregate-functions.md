---
slug: aggregate-functions
title: SQL Aggregate Functions (SUM, COUNT, AVG, MIN, MAX)
description: SQL aggregate functions explained with Northwind examples: SUM, COUNT, AVG, MIN, MAX, COUNT DISTINCT, NULL behavior, grain, and common interview pitfalls.
keywords: sql aggregate functions, sql sum, sql count, sql avg, count distinct, min max sql
questions: 1, 2, 3, 4, 5, 9, 10, 11, 12, 40
related: group-by-having, count-star-vs-count-column, null-handling-coalesce
---

Aggregate functions take many rows and return one value: a total, a count, an average, a minimum, or a maximum. Used alone they summarize a whole table; combined with `GROUP BY` they summarize each group. Most analytics interview questions — revenue by category, top customers, average order value — are built on them.

## Syntax

```sql
SELECT SUM(expr), COUNT(*), COUNT(expr), COUNT(DISTINCT expr),
       AVG(expr), MIN(expr), MAX(expr)
FROM some_table
[WHERE ...]
[GROUP BY ...];

-- PostgreSQL also supports a per-aggregate filter:
SELECT COUNT(*) FILTER (WHERE condition) FROM some_table;
```

## Example

**Business question:** For each category, what is total net revenue, the number of distinct orders, and the largest single line-item value?

```sql
SELECT cat.category_name,
       ROUND(SUM(od.unit_price * od.quantity * (1 - od.discount))::numeric, 2) AS revenue,
       COUNT(DISTINCT od.order_id)                                            AS orders,
       ROUND(MAX(od.unit_price * od.quantity * (1 - od.discount))::numeric, 2) AS biggest_line
FROM categories cat
JOIN products p       ON p.category_id = cat.category_id
JOIN order_details od ON od.product_id = p.product_id
GROUP BY cat.category_name
ORDER BY revenue DESC;
```

Illustrative result:

| category_name | revenue | orders | biggest_line |
|---|---|---|---|
| Beverages | 267868.18 | 354 | 15810.00 |
| Dairy Products | 234507.29 | 303 | 10540.00 |
| Confections | 167357.23 | 334 | 3952.50 |

Note that revenue uses `order_details.unit_price` (the price at the time of sale), not `products.unit_price` (the current catalog price).

## How it works

- **`SUM` / `AVG`** ignore NULLs. If every input is NULL, or there are no rows, they return NULL — not 0.
- **`COUNT(*)`** counts rows, including rows full of NULLs. **`COUNT(col)`** counts only non-NULL values. **`COUNT(DISTINCT col)`** counts unique non-NULL values.
- **`MIN` / `MAX`** work on numbers, dates, and text. `MAX(order_date)` gives the latest order.
- **Grain matters.** An aggregate's meaning depends on what one input row represents. After joining `orders` to `order_details`, each row is a line item, so `COUNT(*)` counts lines, not orders.

Average order value is the classic grain trap. You must total each order first, then average those totals:

```sql
WITH order_totals AS (
    SELECT o.order_id, o.customer_id,
           SUM(od.unit_price * od.quantity * (1 - od.discount)) AS order_value
    FROM orders o
    JOIN order_details od ON od.order_id = o.order_id
    GROUP BY o.order_id, o.customer_id
)
SELECT customer_id, ROUND(AVG(order_value)::numeric, 2) AS avg_order_value
FROM order_totals
GROUP BY customer_id
ORDER BY avg_order_value DESC;
```

`AVG(od.unit_price * od.quantity * (1 - od.discount))` directly on the join would average line items, which understates order value.

## Common mistakes

- **AVG at the wrong grain.** A recorded mistake on this site's Q40: averaging line-item revenue instead of per-order totals. Always ask "one row = what?" before calling `AVG`.
- **Counting orders after a fan-out join.** `COUNT(o.order_id)` after joining `order_details` counts each order once per line. Use `COUNT(DISTINCT o.order_id)`.
- **Expecting `SUM` to return 0.** With a `LEFT JOIN` and no matches, `SUM` returns NULL. Wrap it: `COALESCE(SUM(...), 0)`.
- **Using catalog price for history.** `products.unit_price` may have changed since the order. Use `order_details.unit_price`.
- **Integer division in ratios.** `SUM(quantity) / COUNT(*)` on integers truncates. Cast: `SUM(quantity)::numeric / COUNT(*)`.
- **Rounding a `real` value.** `discount` is `REAL`, so the revenue expression is double precision. `ROUND(x, 2)` needs `numeric`; cast with `::numeric` first.

## When to use it vs alternatives

| Goal | Tool |
|---|---|
| One total for the whole table | Aggregate without `GROUP BY` |
| One total per group | Aggregate + `GROUP BY` |
| Total shown beside each detail row | Window aggregate: `SUM(...) OVER (PARTITION BY ...)` |
| Conditional counts in one pass | `COUNT(*) FILTER (WHERE ...)` or `SUM(CASE WHEN ... THEN 1 ELSE 0 END)` |
| Breadth (how many different things) | `COUNT(DISTINCT ...)` |
| Volume (how much) | `SUM` / `COUNT(*)` |

## Interview questions

### Do aggregate functions ignore NULL values?
Yes, all standard aggregates except `COUNT(*)` skip NULLs. `COUNT(*)` counts rows regardless of content. If all inputs are NULL, `SUM`, `AVG`, `MIN`, and `MAX` return NULL, while `COUNT(col)` returns 0.

### What is the difference between COUNT(col) and COUNT(DISTINCT col)?
`COUNT(col)` counts every non-NULL value, including repeats. `COUNT(DISTINCT col)` counts each unique non-NULL value once. Use the distinct form for breadth metrics, such as how many different categories a customer bought from.

### How do you calculate average order value correctly?
First sum line items to one total per order, then take `AVG` of those totals. Averaging directly over `order_details` rows gives the average line-item value, which is a different metric.

### Can you nest aggregate functions in SQL?
Not directly; `AVG(SUM(x))` is an error in PostgreSQL. Compute the inner aggregate in a CTE or subquery, then aggregate its result. A window function such as `AVG(SUM(x)) OVER ()` is an allowed alternative because the window runs after grouping.

## Practice

Practice this pattern with the questions below.
