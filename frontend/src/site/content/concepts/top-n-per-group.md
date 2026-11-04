---
slug: top-n-per-group
title: SQL Top N per Group: ROW_NUMBER, RANK and LATERAL
description: Learn SQL top N per group with Northwind examples using ROW_NUMBER, RANK and LATERAL joins, plus tie handling and the mistakes interviewers look for.
keywords: sql top n per group, top 3 per category sql, row_number partition by, greatest n per group, lateral join top n, first row per group
questions: 14, 23, 24, 98, 100, 107
related: window-functions, rank-vs-dense-rank-vs-row-number, cte, correlated-subquery
---

"Top N per group" means returning the best few rows inside each group: the top 3 products per category, the latest order per customer, the best customer per employee. A plain `ORDER BY ... LIMIT` cannot do it, because `LIMIT` applies to the whole result, not to each group. The standard answer is a ranking window function partitioned by the group, filtered in an outer query.

## Syntax

```sql
WITH ranked AS (
    SELECT group_col,
           item_col,
           metric,
           ROW_NUMBER() OVER (PARTITION BY group_col ORDER BY metric DESC) AS rn
    FROM some_table
)
SELECT *
FROM ranked
WHERE rn <= N;

-- PostgreSQL alternative: LATERAL
SELECT g.group_col, t.*
FROM groups g
CROSS JOIN LATERAL (
    SELECT ... FROM items i
    WHERE i.group_id = g.group_id
    ORDER BY i.metric DESC
    LIMIT N
) t;
```

## Example

**Business question:** For each category, show the two products with the highest revenue.

```sql
WITH product_revenue AS (
    SELECT c.category_name,
           p.product_name,
           SUM(od.unit_price * od.quantity * (1 - od.discount)) AS revenue
    FROM order_details od
    JOIN products p   ON p.product_id  = od.product_id
    JOIN categories c ON c.category_id = p.category_id
    GROUP BY c.category_name, p.product_name
),
ranked AS (
    SELECT *,
           ROW_NUMBER() OVER (PARTITION BY category_name ORDER BY revenue DESC) AS rn
    FROM product_revenue
)
SELECT category_name, product_name, ROUND(revenue::numeric, 2) AS revenue, rn
FROM ranked
WHERE rn <= 2
ORDER BY category_name, rn;
```

Illustrative result (first rows):

| category_name | product_name | revenue | rn |
|---|---|---|---|
| Beverages | Côte de Blaye | 17509.57 | 1 |
| Beverages | Ipoh Coffee | 2371.30 | 2 |
| Condiments | Northwoods Cranberry Sauce | 3148.00 | 1 |
| Condiments | Gula Malacca | 2396.24 | 2 |
| Confections | Sir Rodney's Marmalade | 5576.85 | 1 |
| Confections | Schoggi Schokolade | 3700.77 | 2 |

## How it works

1. The first CTE aggregates revenue to one row per product.
2. `PARTITION BY category_name` restarts numbering for every category; `ORDER BY revenue DESC` puts the best product at 1.
3. The outer query filters `rn <= 2`. The filter must be outside, because window functions are computed after `WHERE` (see [SQL order of execution](/concepts/sql-order-of-execution)).

**The LATERAL version** runs a small "top N" subquery once per outer row. It is handy when the inner query needs `LIMIT` and the group table is small:

```sql
SELECT c.category_name, t.product_name, t.unit_price
FROM categories c
CROSS JOIN LATERAL (
    SELECT p.product_name, p.unit_price
    FROM products p
    WHERE p.category_id = c.category_id
    ORDER BY p.unit_price DESC
    LIMIT 2
) t
ORDER BY c.category_name, t.unit_price DESC;
```

| category_name | product_name | unit_price |
|---|---|---|
| Beverages | Côte de Blaye | 263.50 |
| Beverages | Ipoh Coffee | 46.00 |
| Condiments | Vegie-spread | 43.90 |

Use `LEFT JOIN LATERAL ... ON true` instead of `CROSS JOIN LATERAL` if groups with no rows must still appear.

**First row per group** is just N = 1. PostgreSQL also offers `DISTINCT ON`, which keeps the first row per key according to `ORDER BY`:

```sql
SELECT DISTINCT ON (customer_id) customer_id, order_id, order_date
FROM orders
ORDER BY customer_id, order_date DESC, order_id DESC;
```

This is the idea behind [Latest Order per Customer](/questions/q147-latest-order-per-customer).

## Common mistakes

- **Filtering the window column in `WHERE`.** `WHERE ROW_NUMBER() OVER (...) <= 3` is an error. Wrap the query in a CTE or subquery first.
- **Forgetting `PARTITION BY`.** Without it you get the global top N, not N per group.
- **Ignoring ties.** `ROW_NUMBER` picks an arbitrary winner among equal values. Use `RANK` or `DENSE_RANK` if tied rows should all be returned, or add a tiebreaker column to `ORDER BY` for a deterministic result.
- **Ranking before aggregating.** Rank the per-product totals, not the raw order lines, or one product will appear several times.
- **`DISTINCT ON` order mismatch.** The leftmost `ORDER BY` columns must match the `DISTINCT ON` expressions.

## When to use it vs alternatives

| Approach | Ties | Best for |
|---|---|---|
| `ROW_NUMBER()` + filter | Exactly N rows | Default; portable to every major database |
| `RANK()` / `DENSE_RANK()` + filter | Keeps ties | "All products tied for first" |
| `CROSS JOIN LATERAL ... LIMIT N` | Exactly N | Few groups, indexed inner table |
| `DISTINCT ON` | One row | N = 1 in PostgreSQL only |
| Correlated subquery with `MAX` | Keeps ties | N = 1, older SQL dialects |

See [RANK vs DENSE_RANK vs ROW_NUMBER](/concepts/rank-vs-dense-rank-vs-row-number) for how each ranking treats ties.

## Interview questions

### How do you get the top 3 rows per group in SQL?
Compute `ROW_NUMBER() OVER (PARTITION BY group ORDER BY metric DESC)` in a CTE or subquery, then keep rows where the number is at most 3 in the outer query. Swap in `DENSE_RANK` if ties should all be included.

### Why can't you use LIMIT for top N per group?
`LIMIT` is applied once to the final result set, so it returns the top N overall. To limit within each group you need either a partitioned window function or a `LATERAL` subquery that runs its own `LIMIT` per group.

### What happens with ties when using ROW_NUMBER?
Tied rows receive different numbers in an unpredictable order, so one may be cut off at the boundary. Add a tiebreaker such as the primary key for repeatable output, or use `RANK` to keep every tied row.

### How do you return the first row per group in PostgreSQL?
Use `DISTINCT ON (group_col)` with `ORDER BY group_col, sort_col DESC`, or `ROW_NUMBER() ... WHERE rn = 1`. `DISTINCT ON` is shorter but PostgreSQL-specific.

## Practice

Practice this pattern with the questions below.
