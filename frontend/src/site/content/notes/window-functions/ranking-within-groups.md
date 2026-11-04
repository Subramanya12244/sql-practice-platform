---
title: Ranking within groups
slug: ranking-within-groups
category: window-functions
difficulty: Advanced
description: Rank rows per group with PARTITION BY, choose ROW_NUMBER, RANK or DENSE_RANK for ties, and solve top-N per group in PostgreSQL.
prerequisites: [row-number, rank, dense-rank, partition-by]
related: [row-number, rank, dense-rank, cte]
questions: [14, 23, 24, 98, 100, 106, 108]
patterns: [top-n-per-group, latest-record-per-group, nth-highest]
guides: [top-n-per-group, rank-vs-dense-rank-vs-row-number]
minutes: 10
version: 1
---

## Introduction

"Top 3 products per category", "best customer per employee", "latest order per customer": all ranking within groups. The recipe is always: aggregate, rank with `PARTITION BY`, filter in an outer query.

## Definition

Ranking within groups means applying a ranking function with `PARTITION BY group ORDER BY metric` so ranks restart for each group.

## Why it matters

- Top-N per group is among the most asked SQL interview problems.
- Choosing the ranking function decides how ties are handled.

## How it works

| Need | Function |
|---|---|
| exactly N rows per group | `ROW_NUMBER` + tiebreaker |
| all rows tied at the cut-off | `RANK` |
| top N distinct values | `DENSE_RANK` |
| buckets / quartiles | `NTILE(n)` |
| relative position 0..1 | `PERCENT_RANK`, `CUME_DIST` |

Steps: CTE that aggregates → CTE that ranks → `WHERE rnk <= N`.

## Syntax

```sql-syntax
WITH ranked AS (
  SELECT g, item, metric,
         {ROW_NUMBER|RANK|DENSE_RANK}() OVER (PARTITION BY g ORDER BY metric DESC, item) AS rnk
  FROM source
)
SELECT * FROM ranked WHERE rnk <= N;
```

## Simple examples

Top 2 most expensive products per category:

```sql
WITH r AS (
  SELECT category_id, product_name, unit_price,
         ROW_NUMBER() OVER (PARTITION BY category_id ORDER BY unit_price DESC, product_id) AS rn
  FROM products
)
SELECT category_id, rn, product_name, unit_price
FROM r
WHERE rn <= 2
ORDER BY category_id, rn;
```

## Intermediate examples

Best customer per employee by revenue, ties kept (question 23):

```sql
WITH rev AS (
  SELECT o.employee_id, o.customer_id,
         SUM(od.unit_price * od.quantity * (1 - od.discount)) AS revenue
  FROM orders o
  JOIN order_details od ON od.order_id = o.order_id
  WHERE o.employee_id IS NOT NULL
  GROUP BY o.employee_id, o.customer_id
), r AS (
  SELECT *, RANK() OVER (PARTITION BY employee_id ORDER BY revenue DESC) AS rnk
  FROM rev
)
SELECT employee_id, customer_id, ROUND(revenue::numeric, 2) AS revenue
FROM r
WHERE rnk = 1
ORDER BY employee_id;
```

## Advanced examples

All three ranking functions on the same partition (question 99 style):

```sql
SELECT category_id, product_name, unit_price,
       ROW_NUMBER() OVER w AS rn,
       RANK()       OVER w AS rnk,
       DENSE_RANK() OVER w AS drnk
FROM products
WINDOW w AS (PARTITION BY category_id ORDER BY unit_price DESC)
ORDER BY category_id, unit_price DESC
LIMIT 12;
```

Quartiles and percentile rank of customer revenue (questions 106, 108):

```sql
WITH rev AS (
  SELECT o.customer_id, SUM(od.unit_price * od.quantity * (1 - od.discount))::numeric AS revenue
  FROM orders o
  JOIN order_details od ON od.order_id = o.order_id
  GROUP BY o.customer_id
)
SELECT customer_id, ROUND(revenue, 2) AS revenue,
       NTILE(4) OVER (ORDER BY revenue DESC) AS quartile,
       ROUND(PERCENT_RANK() OVER (ORDER BY revenue)::numeric, 3) AS pct_rank,
       ROUND(CUME_DIST() OVER (ORDER BY revenue)::numeric, 3) AS cume_dist
FROM rev
ORDER BY revenue DESC
LIMIT 10;
```

PostgreSQL alternative for top-1 per group: `DISTINCT ON`.

```sql
SELECT DISTINCT ON (customer_id) customer_id, order_id, order_date
FROM orders
ORDER BY customer_id, order_date DESC, order_id DESC
LIMIT 10;
```

Top-N with `LATERAL` (good with an index on the inner table):

```sql
SELECT c.category_name, p.product_name, p.unit_price
FROM categories c
CROSS JOIN LATERAL (
  SELECT product_name, unit_price
  FROM products p
  WHERE p.category_id = c.category_id
  ORDER BY unit_price DESC
  LIMIT 2
) p
ORDER BY c.category_name, p.unit_price DESC;
```

## Real-world scenarios

- Top sellers per region on a dashboard.
- Latest status per entity.
- Segmenting customers into quartiles.

## PostgreSQL specifics

- `DISTINCT ON` is PostgreSQL-only; it returns one row per key and cannot keep ties.
- `LATERAL` joins are supported (PostgreSQL 9.3+).
- No `QUALIFY` clause in PostgreSQL 16.

## Visual explanation

```text
group A (illustrative)   group B
price rn rnk drnk        price rn rnk drnk
 90   1  1   1            50   1  1   1   <- ranks restart
 70   2  2   2            40   2  2   2
 70   3  2   2            30   3  3   3
 20   4  4   3
```

## Common mistakes

- Forgetting `PARTITION BY`: ranks across all groups.
- Filtering the rank in the same `SELECT` (`WHERE rnk <= 3` on the same level is an error).
- Wrong function for ties (ROW_NUMBER silently drops tied rows).
- Ranking before aggregation; aggregate first, then rank.
- `ORDER BY metric` without `DESC` for "top".

## Performance

- The rank approach scans and sorts everything once: fine for most sizes.
- `LATERAL ... LIMIT N` with an index on `(group, metric DESC)` reads only N rows per group; better when groups are few and tables large.
- `DISTINCT ON` is efficient for top-1 with a matching index.

## Interview questions

### How do you get the top 3 products by revenue per category?

Aggregate revenue per product, rank with `DENSE_RANK() OVER (PARTITION BY category_id ORDER BY revenue DESC)` (or `ROW_NUMBER` for exactly 3), filter `<= 3` in an outer query.

### Which ranking function should you use?

`ROW_NUMBER` for exactly N, `RANK` to keep ties at the cut-off with gaps, `DENSE_RANK` for N distinct values.

### Alternatives to window functions for top-N per group?

`DISTINCT ON` (top-1, PostgreSQL), `LATERAL` with `LIMIT`, or a correlated subquery counting rows that beat the current one.

### What do NTILE and PERCENT_RANK do?

`NTILE(n)` splits ordered rows into n near-equal buckets. `PERCENT_RANK` = `(rank - 1) / (rows - 1)`, from 0 to 1.

## Quick revision

- Aggregate → rank with `PARTITION BY` → filter outside.
- `ROW_NUMBER` exact N; `RANK` ties with gaps; `DENSE_RANK` distinct values.
- Add a tiebreaker for deterministic `ROW_NUMBER`.
- `DISTINCT ON` and `LATERAL` are PostgreSQL alternatives.
- `NTILE`, `PERCENT_RANK`, `CUME_DIST` for buckets and percentiles.
