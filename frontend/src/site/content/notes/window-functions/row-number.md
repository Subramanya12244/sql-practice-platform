---
title: ROW_NUMBER
slug: row-number
category: window-functions
difficulty: Intermediate
description: ROW_NUMBER assigns a unique sequential number to each row in a partition; the go-to tool for dedup, latest-per-group and pagination.
prerequisites: [over, partition-by, window-order-by]
related: [rank, dense-rank, ranking-within-groups, cte]
questions: [98, 100, 14, 23]
patterns: [latest-record-per-group, top-n-per-group, remove-duplicates, find-duplicates]
guides: [rank-vs-dense-rank-vs-row-number, top-n-per-group]
minutes: 8
version: 1
---

## Introduction

`ROW_NUMBER()` numbers rows 1, 2, 3... in the window order. It never repeats a number, even for ties, which makes it the right tool when you need **exactly one** row per group.

## Definition

`ROW_NUMBER() OVER ([PARTITION BY ...] ORDER BY ...)` returns the position of the current row within its partition, starting at 1. Ties get different numbers in an unspecified order.

## Why it matters

- Latest/first record per group.
- Removing duplicates while keeping one copy.
- Stable pagination and sampling.

## How it works

1. Partition rows.
2. Sort each partition by the window `ORDER BY`.
3. Number rows 1..n. The frame is ignored.

If the sort key has ties, which tied row gets 1 is arbitrary. Add a unique tiebreaker to make it deterministic.

## Syntax

```sql-syntax
ROW_NUMBER() OVER ([PARTITION BY p] ORDER BY k [, tiebreaker])
```

## Simple examples

```sql
SELECT product_name, unit_price,
       ROW_NUMBER() OVER (ORDER BY unit_price DESC, product_id) AS rn
FROM products
ORDER BY rn
LIMIT 5;
```

## Intermediate examples

Latest order per customer (question 98 pattern):

```sql
WITH ranked AS (
  SELECT order_id, customer_id, order_date,
         ROW_NUMBER() OVER (PARTITION BY customer_id
                            ORDER BY order_date DESC, order_id DESC) AS rn
  FROM orders
)
SELECT customer_id, order_id, order_date
FROM ranked
WHERE rn = 1
ORDER BY customer_id
LIMIT 10;
```

## Advanced examples

Find duplicate-like rows: customers sharing a country and city, keeping the first one by id.

```sql
WITH d AS (
  SELECT customer_id, country, city,
         ROW_NUMBER() OVER (PARTITION BY country, city ORDER BY customer_id) AS rn
  FROM customers
)
SELECT customer_id, country, city, rn
FROM d
WHERE rn > 1
ORDER BY country, city;
```

Delete with `ROW_NUMBER`: keep at most 3 lines per order and remove the rest (same shape as dedup with `rn > 1`; shown with `RETURNING`):

```sql
DELETE FROM order_details od
USING (
  SELECT ctid,
         ROW_NUMBER() OVER (PARTITION BY order_id ORDER BY product_id) AS rn
  FROM order_details
) d
WHERE od.ctid = d.ctid AND d.rn > 3
RETURNING od.order_id, od.product_id;
```

Pagination: page 2 with 5 rows per page.

```sql
SELECT *
FROM (
  SELECT product_id, product_name,
         ROW_NUMBER() OVER (ORDER BY product_name) AS rn
  FROM products
) p
WHERE rn BETWEEN 6 AND 10;
```

## Real-world scenarios

- Current address/status per user from a history table.
- Dedup ingested events.
- Pick one representative row per group.

## PostgreSQL specifics

- `DISTINCT ON (customer_id) ... ORDER BY customer_id, order_date DESC` is a PostgreSQL-only shortcut for top-1 per group.
- `ctid` (physical row id) is handy for deleting exact duplicates when there is no key; it is PostgreSQL-specific.
- No `QUALIFY`; filter `rn` in an outer query.

## Visual explanation

| customer | order_date | ROW_NUMBER | RANK | DENSE_RANK |
|---|---|---|---|---|
| A | 2025-03-01 | 1 | 1 | 1 |
| A | 2025-03-01 | 2 | 1 | 1 |
| A | 2025-01-10 | 3 | 3 | 2 |

## Common mistakes

- No tiebreaker: results change between runs.
- `WHERE ROW_NUMBER() OVER (...) = 1` directly: not allowed.
- Using `ROW_NUMBER` when ties should all be returned; use `RANK`/`DENSE_RANK`.

## Performance

- Needs a sort on `(partition, order)`; an index matching it lets PostgreSQL skip the sort.
- For top-1 per group on big tables, `DISTINCT ON` or a `LATERAL ... LIMIT 1` with a good index can be faster.

## Interview questions

### ROW_NUMBER vs RANK vs DENSE_RANK?

For ties: `ROW_NUMBER` gives 1,2,3; `RANK` gives 1,1,3; `DENSE_RANK` gives 1,1,2.

### How do you get the latest row per group?

`ROW_NUMBER() OVER (PARTITION BY g ORDER BY ts DESC, id DESC)` in a CTE, then `WHERE rn = 1`. In PostgreSQL, `DISTINCT ON` also works.

### How do you delete duplicates but keep one?

Number rows per duplicate key with `ROW_NUMBER`, delete rows where `rn > 1` (join back by primary key or `ctid`).

## Quick revision

- Unique 1..n per partition.
- Ties broken arbitrarily; add a tiebreaker.
- Frame ignored.
- Filter in outer query: `WHERE rn = 1`.
- Uses: latest per group, dedup, pagination.
