---
title: Latest record per group
slug: latest-record-per-group
category: latest
difficulty: Intermediate
description: Fetch the most recent row for each key with ROW_NUMBER, DISTINCT ON in PostgreSQL, or a join to MAX(date).
questions: [147, 26, 167]
notes: [row-number, partition-by, correlated-subqueries, min-max]
guides: [top-n-per-group]
---

## Problem

Return the whole latest row for each group, such as each customer's most recent order with its date, employee and freight.

## When to use it

- Current status per entity from a history table.
- Latest order, login, price or event per customer or product.

## Solution

```sql
SELECT customer_id, order_id, order_date, freight
FROM (
  SELECT o.*,
         ROW_NUMBER() OVER (PARTITION BY customer_id
                            ORDER BY order_date DESC, order_id DESC) AS rn
  FROM orders o
) t
WHERE rn = 1
ORDER BY customer_id;
```

## Alternatives

`DISTINCT ON` is PostgreSQL-specific and very short:

```sql
SELECT DISTINCT ON (customer_id)
       customer_id, order_id, order_date, freight
FROM orders
ORDER BY customer_id, order_date DESC, order_id DESC;
```

Join to the maximum date (portable, but returns all orders tied on the latest date):

```sql
SELECT o.customer_id, o.order_id, o.order_date
FROM orders o
JOIN (
  SELECT customer_id, MAX(order_date) AS last_date
  FROM orders
  GROUP BY customer_id
) m ON m.customer_id = o.customer_id
   AND m.last_date = o.order_date
ORDER BY o.customer_id;
```

`ROW_NUMBER` is portable and returns exactly one row. `DISTINCT ON` is the shortest form in PostgreSQL. The `MAX` join keeps ties.

## How it works

The window numbers each customer's orders from newest to oldest. Row 1 is the latest. `DISTINCT ON (customer_id)` keeps the first row of each customer after the `ORDER BY`, so the sort decides which row survives.

## Execution walkthrough

1. Rows are partitioned by `customer_id`.
2. Inside each partition, rows are sorted by `order_date DESC`, then `order_id DESC` to break ties.
3. `ROW_NUMBER` assigns 1 to the newest order.
4. The outer query keeps `rn = 1`, one row per customer who has orders.

## Common mistakes

- `SELECT customer_id, MAX(order_date), order_id … GROUP BY customer_id`. `order_id` is not grouped, so PostgreSQL rejects it, and other databases may return a random id.
- `DISTINCT ON` whose leading `ORDER BY` columns differ from the `DISTINCT ON` columns. PostgreSQL raises an error.
- No tie-breaker, so two orders on the same date make the result non-deterministic.
- Expecting customers without orders. Add a `LEFT JOIN` from `customers` if they must appear.

## Performance

An index on `(customer_id, order_date DESC)` helps all forms. With many rows per group and few groups, a `LATERAL (… ORDER BY order_date DESC LIMIT 1)` per customer is the fastest option.
