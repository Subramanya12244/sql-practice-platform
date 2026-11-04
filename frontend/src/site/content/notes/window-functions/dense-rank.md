---
title: DENSE_RANK
slug: dense-rank
category: window-functions
difficulty: Intermediate
description: DENSE_RANK ranks tied rows equally without gaps, the standard tool for Nth highest value and top-N distinct values per group.
prerequisites: [rank, partition-by]
related: [rank, row-number, ranking-within-groups]
questions: [148, 149]
patterns: [nth-highest, second-highest, top-n-per-group]
guides: [rank-vs-dense-rank-vs-row-number, nth-highest-value, second-highest-value]
minutes: 7
version: 1
---

## Introduction

`DENSE_RANK()` is like `RANK()` but with no gaps: 1,1,2. Rank N means "the N-th distinct value", which is exactly what "second highest salary" style questions want.

## Definition

`DENSE_RANK()` returns the number of distinct `ORDER BY` values up to and including the current row's value within its partition.

## Why it matters

- Nth highest / second highest is a classic interview question.
- "Top 3 products by revenue per category" (question 100) when ties should share a place.

## How it works

1. Partition and sort.
2. Peers share a value.
3. Each new distinct value increments the rank by exactly 1.

## Syntax

```sql-syntax
DENSE_RANK() OVER ([PARTITION BY p] ORDER BY k [DESC])
```

## Simple examples

```sql
SELECT product_name, unit_price,
       RANK()       OVER (ORDER BY unit_price DESC) AS rnk,
       DENSE_RANK() OVER (ORDER BY unit_price DESC) AS dense_rnk
FROM products
ORDER BY unit_price DESC
LIMIT 10;
```

## Intermediate examples

Second highest unit price overall:

```sql
SELECT DISTINCT unit_price
FROM (
  SELECT unit_price, DENSE_RANK() OVER (ORDER BY unit_price DESC) AS dr
  FROM products
) t
WHERE dr = 2;
```

## Advanced examples

Top 3 revenue values per category (question 100):

```sql
WITH rev AS (
  SELECT p.category_id, p.product_name,
         SUM(od.unit_price * od.quantity * (1 - od.discount)) AS revenue
  FROM order_details od
  JOIN products p ON p.product_id = od.product_id
  GROUP BY p.category_id, p.product_name
), r AS (
  SELECT *, DENSE_RANK() OVER (PARTITION BY category_id ORDER BY revenue DESC) AS dr
  FROM rev
)
SELECT category_id, dr, product_name, ROUND(revenue::numeric, 2) AS revenue
FROM r
WHERE dr <= 3
ORDER BY category_id, dr;
```

## Real-world scenarios

- Salary bands and Nth highest salary per department.
- Medal tables where ties share a place and the next place is not skipped.

## PostgreSQL specifics

- Hypothetical-set form exists: `DENSE_RANK(30) WITHIN GROUP (ORDER BY unit_price DESC)`.
- Alternative for Nth distinct value: `SELECT DISTINCT unit_price ... ORDER BY unit_price DESC OFFSET n-1 LIMIT 1`.

## Visual explanation

```text
values:     50  40  40  30
RANK:        1   2   2   4
DENSE_RANK:  1   2   2   3   <- no gap
```

## Common mistakes

- Returning duplicate rows for the Nth value when several rows share it; add `DISTINCT` if only the value is needed.
- Using `RANK` and getting no row for rank 2 because of a tie at 1.
- `NULL` values: they sort last in `ASC` and first in `DESC` in PostgreSQL, so they can take rank 1 for `DESC`. Use `NULLS LAST` or filter them.

## Performance

One sort per window. For "just the 2nd highest value" on an indexed column, `ORDER BY ... DESC OFFSET 1 LIMIT 1` over `DISTINCT` values may be cheaper.

## Interview questions

### Find the second highest price.

Compute `DENSE_RANK() OVER (ORDER BY unit_price DESC)` and filter `= 2`, or `SELECT MAX(unit_price) FROM products WHERE unit_price < (SELECT MAX(unit_price) FROM products)`.

### Why DENSE_RANK and not RANK for Nth highest?

`RANK` leaves gaps after ties, so rank N might not exist. `DENSE_RANK` maps rank N to the N-th distinct value.

### What is the max DENSE_RANK in a partition?

The number of distinct sort values in that partition.

## Quick revision

- Ties share rank, no gaps: 1,1,2.
- Rank N = N-th distinct value.
- Best for Nth highest, top-N distinct values.
- Watch NULLs with `DESC`.
- Frame ignored.
