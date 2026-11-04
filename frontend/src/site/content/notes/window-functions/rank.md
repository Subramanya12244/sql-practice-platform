---
title: RANK
slug: rank
category: window-functions
difficulty: Intermediate
description: RANK gives tied rows the same rank and leaves gaps after ties, ideal for tie-safe top-1 and competition-style ranking.
prerequisites: [row-number, partition-by]
related: [dense-rank, row-number, ranking-within-groups]
questions: [14, 23, 24, 99]
patterns: [top-n-per-group, nth-highest]
guides: [rank-vs-dense-rank-vs-row-number, top-n-per-group]
minutes: 7
version: 1
---

## Introduction

`RANK()` is competition ranking: two people tie for 1st, the next is 3rd. Use it when ties must all be kept, for example "highest revenue product per category, include ties".

## Definition

`RANK()` returns 1 + the number of rows that sort strictly before the current row in its partition. Peers get the same rank; gaps follow ties.

## Why it matters

- Tie-safe "top 1 per group" questions (14, 23, 24).
- Interviewers almost always ask RANK vs DENSE_RANK vs ROW_NUMBER.

## How it works

1. Partition and sort.
2. Rows equal on all `ORDER BY` keys are peers and share a rank.
3. After a peer group of size k with rank r, next rank is r + k.

Without `ORDER BY`, all rows are peers and get rank 1.

## Syntax

```sql-syntax
RANK() OVER ([PARTITION BY p] ORDER BY k [DESC])
```

## Simple examples

```sql
SELECT product_name, unit_price,
       RANK() OVER (ORDER BY unit_price DESC) AS price_rank
FROM products
ORDER BY price_rank, product_name
LIMIT 10;
```

## Intermediate examples

Most expensive product(s) per category, keeping ties:

```sql
WITH r AS (
  SELECT category_id, product_name, unit_price,
         RANK() OVER (PARTITION BY category_id ORDER BY unit_price DESC) AS rnk
  FROM products
)
SELECT category_id, product_name, unit_price
FROM r
WHERE rnk = 1
ORDER BY category_id;
```

## Advanced examples

Highest-revenue product per category (question 14):

```sql
WITH rev AS (
  SELECT p.category_id, p.product_name,
         SUM(od.unit_price * od.quantity * (1 - od.discount)) AS revenue
  FROM order_details od
  JOIN products p ON p.product_id = od.product_id
  GROUP BY p.category_id, p.product_name
), r AS (
  SELECT *, RANK() OVER (PARTITION BY category_id ORDER BY revenue DESC) AS rnk
  FROM rev
)
SELECT category_id, product_name, ROUND(revenue::numeric, 2) AS revenue
FROM r
WHERE rnk = 1
ORDER BY category_id;
```

Window over aggregate directly in one level:

```sql
SELECT o.employee_id,
       COUNT(*) AS orders,
       RANK() OVER (ORDER BY COUNT(*) DESC) AS rnk
FROM orders o
GROUP BY o.employee_id
ORDER BY rnk;
```

## Real-world scenarios

- Leaderboards and sales contests.
- Best seller per region, ties included.
- "Who placed in the top 3" where ties expand the list.

## PostgreSQL specifics

- PostgreSQL also has the hypothetical-set aggregate `RANK(value) WITHIN GROUP (ORDER BY col)`, which returns the rank a value would have.
- `PERCENT_RANK()` = `(rank - 1) / (rows - 1)`.

## Visual explanation

| price | ROW_NUMBER | RANK | DENSE_RANK |
|---|---|---|---|
| 50 | 1 | 1 | 1 |
| 40 | 2 | 2 | 2 |
| 40 | 3 | 2 | 2 |
| 30 | 4 | 4 | 3 |

## Common mistakes

- Using `RANK` for "Nth distinct value": gaps make `rnk = 3` possibly missing. Use `DENSE_RANK`.
- Expecting `WHERE rnk <= 3` to return exactly 3 rows; ties can return more.
- Forgetting `DESC` for "highest".

## Performance

Same as other ranking functions: one sort per window definition; filter rank in an outer query after computing.

## Interview questions

### What does RANK return for ties?

The same rank for all peers, then skips: 1,1,3.

### When would RANK be preferred over ROW_NUMBER?

When all tied rows must be returned, such as every product sharing the top revenue.

### Can rnk = 2 be missing with RANK?

Yes, if two rows tie for rank 1 the next rank is 3.

## Quick revision

- Ties share rank; gaps after ties.
- Rank = 1 + count of rows strictly ahead.
- Tie-safe top-1: `WHERE rnk = 1`.
- For Nth distinct value use `DENSE_RANK`.
- Frame ignored.
