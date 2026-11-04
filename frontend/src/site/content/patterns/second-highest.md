---
title: Second highest value
slug: second-highest
category: ranking
difficulty: Beginner
description: Find the second highest value with MAX below MAX, DENSE_RANK, or OFFSET 1, handling ties and the no-second-value case.
questions: [99, 22, 50]
notes: [dense-rank, scalar-subqueries, limit-offset, min-max]
guides: [second-highest-value]
---

## Problem

Return the second highest distinct value of a column. The classic interview version asks for the second highest salary. Northwind has no salary column, so these examples use `products.unit_price`.

## When to use it

- "Second highest salary" style interview questions.
- Runner-up product, customer or employee by a metric.
- Any case where ties at the top must not count as the second value.

## Solution

```sql
SELECT MAX(unit_price) AS second_highest_price
FROM products
WHERE unit_price < (SELECT MAX(unit_price) FROM products);
```

## Alternatives

`DENSE_RANK` returns every product at the second distinct price, with details:

```sql
SELECT product_name, unit_price
FROM (
  SELECT product_name, unit_price,
         DENSE_RANK() OVER (ORDER BY unit_price DESC) AS rnk
  FROM products
) t
WHERE rnk = 2;
```

`DISTINCT` with `OFFSET`:

```sql
SELECT DISTINCT unit_price
FROM products
ORDER BY unit_price DESC
LIMIT 1 OFFSET 1;
```

The `MAX` form always returns one row, which is NULL when there is no second value. That matches the LeetCode requirement. `OFFSET` returns no row at all in that case. Without `DISTINCT`, `OFFSET 1` returns the top value again when it is tied. `DENSE_RANK` is the easiest to extend to per-group and Nth-highest versions.

## How it works

The subquery finds the highest price. The outer query keeps prices strictly below it and takes their maximum, which is the second distinct value. `DENSE_RANK` gives tied values the same rank with no gaps, so rank 2 is always the second distinct value.

## Execution walkthrough

1. The scalar subquery runs once and returns the highest `unit_price`.
2. `WHERE unit_price < …` removes every product at that price, including ties.
3. `MAX` over the remaining rows returns the second highest price.
4. If all products had the same price, no rows remain and `MAX` returns NULL.

## Common mistakes

- `ORDER BY … LIMIT 1 OFFSET 1` without `DISTINCT`. A tie at the top returns the top value.
- `RANK` instead of `DENSE_RANK`. After a two-way tie for first, `RANK` skips 2, so `rnk = 2` returns nothing.
- Forgetting NULLs. `ORDER BY … DESC` puts NULLs first in PostgreSQL. Add `NULLS LAST` or filter them out.

## Performance

With an index on `unit_price`, both `MAX` lookups are index-only reads at the end of the index. The window version sorts the whole table. For one global value prefer `MAX`. For per-group answers use the window version.
