---
title: LIMIT and OFFSET
slug: limit-offset
category: fundamentals
difficulty: Beginner
description: Return the top N rows and paginate with LIMIT, OFFSET and FETCH FIRST in PostgreSQL, plus why keyset pagination beats large offsets.
prerequisites: [order-by]
related: [order-by, row-number, dense-rank, indexes, query-optimization]
questions: [3, 4, 5, 20, 171]
patterns: [second-highest, nth-highest, top-n-per-group]
guides: [second-highest-value, nth-highest-value]
minutes: 6
version: 1
---

## Introduction

`LIMIT` caps how many rows a query returns; `OFFSET` skips rows first. Together with `ORDER BY` they give top-N lists and pages.

## Definition

`LIMIT n` returns at most n rows. `OFFSET m` discards the first m rows of the sorted result. The standard SQL form is `OFFSET m ROWS FETCH FIRST n ROWS ONLY`.

## Why it matters

"Top 5 customers by revenue" is one of the most common interview prompts. The follow-ups are ties, the second-highest value, and pagination performance.

## How it works

`LIMIT`/`OFFSET` are applied last, after `ORDER BY`. Without `ORDER BY` you get an arbitrary subset.

## Syntax

```sql-syntax
SELECT ... ORDER BY sort_key LIMIT n OFFSET m;

-- SQL standard (also supported by PostgreSQL)
SELECT ... ORDER BY sort_key
OFFSET m ROWS FETCH FIRST n ROWS ONLY;

SELECT ... ORDER BY sort_key FETCH FIRST n ROWS WITH TIES;
```

## Simple examples

Five most expensive products:

```sql
SELECT product_name, unit_price
FROM products
ORDER BY unit_price DESC, product_id
LIMIT 5;
```

Page 2 with 10 rows per page:

```sql
SELECT customer_id, company_name
FROM customers
ORDER BY customer_id
LIMIT 10 OFFSET 10;
```

## Intermediate examples

Top 5 customers by number of orders:

```sql
SELECT customer_id, COUNT(*) AS orders
FROM orders
GROUP BY customer_id
ORDER BY orders DESC, customer_id
LIMIT 5;
```

Second-highest distinct price:

```sql
SELECT DISTINCT unit_price
FROM products
ORDER BY unit_price DESC
LIMIT 1 OFFSET 1;
```

## Advanced examples

Keep ties at the cut-off with `WITH TIES` (PostgreSQL 13+):

```sql
SELECT customer_id, COUNT(*) AS orders
FROM orders
GROUP BY customer_id
ORDER BY orders DESC
FETCH FIRST 3 ROWS WITH TIES;
```

Keyset (seek) pagination: remember the last key of the previous page instead of using `OFFSET`.

```sql
SELECT customer_id, company_name
FROM customers
WHERE customer_id > 'CACTU'
ORDER BY customer_id
LIMIT 10;
```

## Real-world scenarios

- Dashboards: top 10 products, worst 5 shippers.
- API pagination: keyset for feeds and large tables, offset for small admin lists.
- Sampling a table during exploration (`LIMIT 20`).

## PostgreSQL specifics

- `LIMIT`/`OFFSET` are PostgreSQL and MySQL syntax; SQL Server uses `TOP` or `OFFSET ... FETCH`; Oracle 12c+ uses `FETCH FIRST`.
- `FETCH FIRST ... WITH TIES` needs an `ORDER BY` and is available from PostgreSQL 13.
- `LIMIT ALL` means no limit.

## Visual explanation

```text
sorted rows:  r1 r2 r3 r4 r5 r6 r7 r8 r9 ...
OFFSET 3:     ── ── ── r4 r5 r6 r7 ...
LIMIT 2:               r4 r5
```

## Common mistakes

- `LIMIT` without `ORDER BY`: undefined rows.
- No tie-breaker: page contents change between requests.
- Second-highest via `OFFSET 1` without `DISTINCT`: returns a tie of the highest.
- Large `OFFSET` on big tables: slow, because skipped rows are still read.
- Assuming `LIMIT 5` gives "top 5 including ties".

## Performance

With an index on the sort key, `ORDER BY ... LIMIT n` stops after n rows (top-N heapsort or index scan). `OFFSET m` still produces and throws away m rows, so cost grows with page number. Keyset pagination stays fast at any depth.

## Interview questions

### How do you get the second-highest salary or price?

`SELECT DISTINCT price ... ORDER BY price DESC LIMIT 1 OFFSET 1`, or `DENSE_RANK() = 2`, or `MAX(price) WHERE price < (SELECT MAX(price) ...)`.

### Why is OFFSET pagination slow on deep pages?

The database must generate and discard all skipped rows. Keyset pagination uses `WHERE key > last_key` and an index.

### How do you include ties in a top-N result?

`FETCH FIRST n ROWS WITH TIES`, or filter on `RANK() <= n` / `DENSE_RANK() <= n`.

### What does LIMIT do without ORDER BY?

Returns any n rows; the choice is not guaranteed.

## Quick revision

- `LIMIT n OFFSET m` runs after `ORDER BY`.
- Always sort with a unique tie-breaker first.
- `FETCH FIRST n ROWS WITH TIES` keeps ties (PostgreSQL 13+).
- Use `DISTINCT` or `DENSE_RANK` for "Nth highest value".
- Prefer keyset pagination for deep pages.
