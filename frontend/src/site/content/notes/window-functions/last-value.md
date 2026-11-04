---
title: LAST_VALUE
slug: last-value
category: window-functions
difficulty: Advanced
description: LAST_VALUE returns the value at the last row of the frame; learn why the default frame breaks it and how to fix it in PostgreSQL.
prerequisites: [first-value, window-order-by]
related: [first-value, lead, row-number]
questions: [107]
patterns: [latest-record-per-group, earliest-latest-transactions]
guides: [window-functions]
minutes: 8
version: 1
---

## Introduction

`LAST_VALUE` is the classic window-function trap. Written naively it returns the current row's value instead of the group's last value. The cause is the default frame.

## Definition

`LAST_VALUE(expr)` returns `expr` evaluated at the last row of the **window frame** for the current row.

## Why it matters

- "Latest product per customer" next to every row (question 107).
- Interviewers ask "why is LAST_VALUE wrong here?" to test frame knowledge.

## How it works

With `ORDER BY`, the default frame is `RANGE BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW`. The frame ends at the current row (plus its peers). So `LAST_VALUE` returns the current row's value, or the last peer's value when there are ties.

Fix: extend the frame to the partition end.

```sql-syntax
LAST_VALUE(x) OVER (PARTITION BY p ORDER BY k
                    ROWS BETWEEN UNBOUNDED PRECEDING AND UNBOUNDED FOLLOWING)
```

## Syntax

```sql-syntax
LAST_VALUE(expr) OVER ([PARTITION BY p] ORDER BY k
                       { ROWS | RANGE | GROUPS } BETWEEN ... AND UNBOUNDED FOLLOWING)
```

## Simple examples

Broken vs fixed:

```sql
SELECT customer_id, order_id, order_date,
       LAST_VALUE(order_id) OVER (PARTITION BY customer_id ORDER BY order_date, order_id) AS wrong_last,
       LAST_VALUE(order_id) OVER (PARTITION BY customer_id ORDER BY order_date, order_id
                                  ROWS BETWEEN UNBOUNDED PRECEDING AND UNBOUNDED FOLLOWING) AS last_order
FROM orders
ORDER BY customer_id, order_date
LIMIT 8;
```

`wrong_last` equals `order_id` on every row.

## Intermediate examples

First and latest product per customer (question 107):

```sql
SELECT DISTINCT o.customer_id,
       FIRST_VALUE(p.product_name) OVER w AS first_product,
       LAST_VALUE(p.product_name)  OVER w AS latest_product
FROM orders o
JOIN order_details od ON od.order_id = o.order_id
JOIN products p ON p.product_id = od.product_id
WINDOW w AS (PARTITION BY o.customer_id
             ORDER BY o.order_date, o.order_id, p.product_id
             ROWS BETWEEN UNBOUNDED PRECEDING AND UNBOUNDED FOLLOWING)
ORDER BY o.customer_id
LIMIT 8;
```

## Advanced examples

Alternative without frame clauses: `FIRST_VALUE` with reversed order.

```sql
SELECT customer_id, order_id, order_date,
       FIRST_VALUE(order_id) OVER (PARTITION BY customer_id
                                   ORDER BY order_date DESC, order_id DESC) AS last_order
FROM orders
ORDER BY customer_id, order_date
LIMIT 8;
```

The peer effect with the default `RANGE` frame: ordering only by `order_date`, same-day orders all see the last peer.

```sql
SELECT order_id, order_date,
       LAST_VALUE(order_id) OVER (ORDER BY order_date) AS last_peer
FROM orders
WHERE order_date IN (SELECT order_date FROM orders GROUP BY order_date HAVING COUNT(*) > 1)
ORDER BY order_date, order_id
LIMIT 6;
```

## Real-world scenarios

- Closing price of the day on each tick row.
- Current status of an entity on every history row.
- Latest plan per subscriber.

## PostgreSQL specifics

- Frame end `UNBOUNDED FOLLOWING` works in `ROWS`, `RANGE` and `GROUPS` modes.
- `NTH_VALUE(x, n)` has the same frame trap.
- No `IGNORE NULLS` in PostgreSQL 16.

## Visual explanation

```text
rows (ordered)   default frame for row 2   fixed frame
row1  A          [row1 row2]               [row1 row2 row3]
row2  B  <- cur   LAST_VALUE = B            LAST_VALUE = C
row3  C
```

## Common mistakes

- Using the default frame (the main bug).
- Fixing with `RANGE ... UNBOUNDED FOLLOWING` is correct too; `ROWS` is just clearer.
- Ties in the order key make "last" arbitrary; add a tiebreaker.

## Performance

A frame to `UNBOUNDED FOLLOWING` is cheap for `LAST_VALUE`. Reversed `FIRST_VALUE` or `ROW_NUMBER` + filter are equally valid.

## Interview questions

### Why does LAST_VALUE return the current row's value?

The default frame with `ORDER BY` ends at the current row (`RANGE ... CURRENT ROW`), so the last row of the frame is the current row or its last peer.

### How do you fix it?

Add `ROWS BETWEEN UNBOUNDED PRECEDING AND UNBOUNDED FOLLOWING`, or use `FIRST_VALUE` with descending order.

### Which other function has the same issue?

`NTH_VALUE`, and any aggregate when you expect a whole-partition result but include `ORDER BY`.

## Quick revision

- Default frame ends at current row: naive `LAST_VALUE` is wrong.
- Fix: `ROWS BETWEEN UNBOUNDED PRECEDING AND UNBOUNDED FOLLOWING`.
- Or `FIRST_VALUE` with `ORDER BY ... DESC`.
- Ties: default `RANGE` returns last peer.
- Same trap for `NTH_VALUE`.
