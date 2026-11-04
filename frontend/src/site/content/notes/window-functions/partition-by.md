---
title: PARTITION BY
slug: partition-by
category: window-functions
difficulty: Intermediate
description: PARTITION BY splits rows into independent groups for a window function, like GROUP BY but without collapsing rows.
prerequisites: [over, group-by]
related: [window-order-by, row-number, rank, ranking-within-groups]
questions: [14, 23, 98, 104, 109]
patterns: [top-n-per-group, latest-record-per-group]
guides: [window-functions, top-n-per-group]
minutes: 8
version: 1
---

## Introduction

`PARTITION BY` is the "per group" part of a window. Each partition is computed on its own: rankings restart, sums reset, `LAG` never looks into another partition.

## Definition

`PARTITION BY expr, ...` inside `OVER (...)` divides the rows into partitions sharing the same values of the expressions. The window function only sees rows of the current row's partition.

## Why it matters

- "Per customer", "per category", "per employee" questions are partition questions.
- Top-N per group, latest record per group and per-group comparisons all rely on it.

## How it works

1. Rows are grouped by the partition key (NULLs form one partition together).
2. Within each partition, rows are ordered if `ORDER BY` is given.
3. The function runs separately per partition.
4. Every input row is returned.

Without `PARTITION BY`, the whole result is one partition.

## Syntax

```sql-syntax
f(args) OVER (PARTITION BY col1 [, col2 ...] [ORDER BY ...] [frame])
```

## Simple examples

Category average next to each product:

```sql
SELECT product_name, category_id, unit_price,
       ROUND(AVG(unit_price) OVER (PARTITION BY category_id), 2) AS cat_avg
FROM products
ORDER BY category_id, unit_price DESC
LIMIT 8;
```

Number of orders per customer on every order row:

```sql
SELECT order_id, customer_id,
       COUNT(*) OVER (PARTITION BY customer_id) AS customer_orders
FROM orders
ORDER BY customer_id, order_id
LIMIT 8;
```

## Intermediate examples

Products priced above their category average:

```sql
WITH p AS (
  SELECT product_name, category_id, unit_price,
         AVG(unit_price) OVER (PARTITION BY category_id) AS cat_avg
  FROM products
)
SELECT product_name, category_id, unit_price, ROUND(cat_avg, 2) AS cat_avg
FROM p
WHERE unit_price > cat_avg
ORDER BY category_id, unit_price DESC;
```

## Advanced examples

Partition by an expression: number orders inside each year and month.

```sql
SELECT order_id, order_date,
       ROW_NUMBER() OVER (PARTITION BY DATE_TRUNC('month', order_date)
                          ORDER BY order_date, order_id) AS nth_in_month
FROM orders
ORDER BY order_date, order_id
LIMIT 8;
```

Different partitions in one query:

```sql
SELECT order_id, customer_id, employee_id, freight,
       SUM(freight) OVER (PARTITION BY customer_id) AS cust_freight,
       SUM(freight) OVER (PARTITION BY employee_id) AS emp_freight,
       SUM(freight) OVER ()                         AS all_freight
FROM orders
ORDER BY order_id
LIMIT 5;
```

## Real-world scenarios

- Best-selling product per category.
- Each employee's sales vs team average.
- Days between consecutive orders per customer.

## PostgreSQL specifics

- Partition keys can be any expression, including `DATE_TRUNC(...)`.
- NULL keys are grouped into a single partition, as with `GROUP BY` (the one order with NULL `employee_id` forms its own partition).

## Visual explanation

```text
PARTITION BY category_id
+-----------+-----------+-----------+
| cat 1     | cat 2     | cat 3 ... |
| rows...   | rows...   | rows...   |
| f() runs  | f() runs  | f() runs  |
| here only | here only | here only |
+-----------+-----------+-----------+
```

## Common mistakes

- Using `GROUP BY` when detail rows are needed.
- Forgetting `PARTITION BY` so rankings run across the whole table.
- Partitioning by a too-fine key (for example the primary key), making each partition one row.

## Performance

- Partitioning requires sorting by the partition key (plus any `ORDER BY`). An index on `(partition_key, order_key)` can provide that order.
- Several different partitions in one query mean several sorts; check `EXPLAIN` for multiple `WindowAgg`/`Sort` nodes.

## Interview questions

### How is PARTITION BY different from GROUP BY?

Both group rows by a key. `GROUP BY` returns one row per group; `PARTITION BY` returns all rows and computes the function per group.

### Can you partition by more than one column?

Yes. `PARTITION BY customer_id, DATE_TRUNC('year', order_date)` gives one partition per customer per year.

### What happens with NULL partition keys?

All NULL keys fall into the same partition.

## Quick revision

- `PARTITION BY` = per-group window, rows kept.
- Functions reset at each partition boundary.
- No `PARTITION BY` = one partition.
- Expressions allowed as keys.
- NULLs share one partition.
