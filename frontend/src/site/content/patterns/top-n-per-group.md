---
title: Top N per group
slug: top-n-per-group
category: ranking
difficulty: Intermediate
description: Return the top N rows inside each group with ROW_NUMBER or DENSE_RANK over PARTITION BY, or a LATERAL subquery in PostgreSQL.
questions: [14, 100, 23, 24]
notes: [row-number, dense-rank, partition-by, ranking-within-groups]
guides: [top-n-per-group]
---

## Problem

Return the top N rows of each group, for example the three most expensive products in every category.

## When to use it

- Best sellers per category, top customers per employee, latest N orders per customer.
- Any "for each X, the top N Y" question.

## Solution

```sql
SELECT category_id, product_name, unit_price
FROM (
  SELECT category_id, product_name, unit_price,
         ROW_NUMBER() OVER (PARTITION BY category_id
                            ORDER BY unit_price DESC, product_id) AS rn
  FROM products
) t
WHERE rn <= 3
ORDER BY category_id, rn;
```

## Alternatives

Include ties with `DENSE_RANK` (a group can return more than N rows):

```sql
SELECT category_id, product_name, unit_price
FROM (
  SELECT category_id, product_name, unit_price,
         DENSE_RANK() OVER (PARTITION BY category_id ORDER BY unit_price DESC) AS rnk
  FROM products
) t
WHERE rnk <= 3
ORDER BY category_id, rnk;
```

`LATERAL` in PostgreSQL runs a small `LIMIT` query per group:

```sql
SELECT c.category_name, p.product_name, p.unit_price
FROM categories c
CROSS JOIN LATERAL (
  SELECT product_name, unit_price
  FROM products p
  WHERE p.category_id = c.category_id
  ORDER BY unit_price DESC
  LIMIT 3
) p
ORDER BY c.category_name, p.unit_price DESC;
```

`ROW_NUMBER` returns exactly N rows per group. `DENSE_RANK` returns N distinct values. `LATERAL` is fastest when an index on `(category_id, unit_price)` exists and there are few groups.

## How it works

`PARTITION BY category_id` restarts the numbering for each category. `ORDER BY unit_price DESC` sets which rows come first. The outer query keeps rows numbered 1 to N.

## Execution walkthrough

1. PostgreSQL sorts products by `category_id`, then `unit_price DESC`.
2. `ROW_NUMBER` assigns 1, 2, 3, … and restarts at 1 for each new category.
3. The outer `WHERE rn <= 3` keeps the first three of each category.
4. The final `ORDER BY` lists them by category and rank.

## Common mistakes

- Forgetting `PARTITION BY`, which ranks the whole table instead of each group.
- Filtering the window result in the same `WHERE`. Wrap it in a subquery or CTE.
- No tie-breaker in `ORDER BY` with `ROW_NUMBER`, so tied rows swap between runs.

## Performance

The window version sorts the whole table by partition and order keys. An index on `(category_id, unit_price DESC)` lets `LATERAL` read only N index entries per group.
