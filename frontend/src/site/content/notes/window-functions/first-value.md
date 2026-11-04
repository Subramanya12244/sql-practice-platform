---
title: FIRST_VALUE
slug: first-value
category: window-functions
difficulty: Intermediate
description: FIRST_VALUE returns the value from the first row of the window frame, e.g. each customer's first product or first order date.
prerequisites: [window-order-by, partition-by]
related: [last-value, row-number, lag, min-max]
questions: [156, 168]
patterns: [earliest-latest-transactions, latest-record-per-group]
guides: [window-functions]
minutes: 7
version: 1
---

## Introduction

`FIRST_VALUE` attaches "the first thing in the group" to every row: first product a customer bought, cheapest product in a category, first order date.

## Definition

`FIRST_VALUE(expr)` returns `expr` evaluated at the first row of the **window frame** for the current row.

## Why it matters

- Compare each row with the group's starting value (price vs cheapest, revenue vs first month).
- Unlike `MIN`, it can return a column other than the sort key (the product **name** of the cheapest product).

## How it works

With `ORDER BY` the default frame is `RANGE BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW`. The frame always starts at the partition's first row, so `FIRST_VALUE` works with the default frame. Only a custom frame start (`n PRECEDING`) changes it.

## Syntax

```sql-syntax
FIRST_VALUE(expr) OVER ([PARTITION BY p] ORDER BY k [frame])
```

## Simple examples

Cheapest product name in each category on every row:

```sql
SELECT category_id, product_name, unit_price,
       FIRST_VALUE(product_name) OVER (PARTITION BY category_id
                                       ORDER BY unit_price, product_id) AS cheapest
FROM products
ORDER BY category_id, unit_price
LIMIT 8;
```

## Intermediate examples

First order date per customer and days since first order:

```sql
SELECT customer_id, order_id, order_date,
       FIRST_VALUE(order_date) OVER w AS first_order,
       order_date - FIRST_VALUE(order_date) OVER w AS days_since_first
FROM orders
WINDOW w AS (PARTITION BY customer_id ORDER BY order_date, order_id)
ORDER BY customer_id, order_date
LIMIT 8;
```

## Advanced examples

First product each customer bought (question 107 style), one row per customer:

```sql
SELECT DISTINCT o.customer_id,
       FIRST_VALUE(p.product_name) OVER (PARTITION BY o.customer_id
                                         ORDER BY o.order_date, o.order_id, p.product_id) AS first_product
FROM orders o
JOIN order_details od ON od.order_id = o.order_id
JOIN products p ON p.product_id = od.product_id
ORDER BY o.customer_id
LIMIT 8;
```

Sliding frame: value from 2 rows back (frame start moved).

```sql
SELECT order_id, freight,
       FIRST_VALUE(freight) OVER (ORDER BY order_id ROWS BETWEEN 2 PRECEDING AND CURRENT ROW) AS first_in_3
FROM orders
ORDER BY order_id
LIMIT 5;
```

## Real-world scenarios

- Acquisition channel of a user's first session.
- Opening price of the day.
- Cohort month (first purchase month) per customer.

## PostgreSQL specifics

- PostgreSQL 16 has no `IGNORE NULLS`; NULLs at the first row are returned as-is. Filter or use `ORDER BY x NULLS LAST`.
- `DISTINCT ON` is an alternative when you need one row per group.

## Visual explanation

```text
partition (ordered by price)   frame for row 3 (default)
row1  2.50  <- FIRST_VALUE     [row1 .. row3]
row2  4.50
row3  7.00  current
```

## Common mistakes

- Non-deterministic order with ties; add a tiebreaker.
- Assuming `FIRST_VALUE` is the frame-independent partition first row when a sliding `ROWS n PRECEDING` frame is set.
- Forgetting `DISTINCT` or an outer filter when one row per group is wanted.

## Performance

One sort per window. For top-1 per group with many columns, `ROW_NUMBER` + filter or `DISTINCT ON` often reads clearer.

## Interview questions

### FIRST_VALUE vs MIN?

`MIN(x)` returns the smallest `x`. `FIRST_VALUE(y) ... ORDER BY x` returns `y` from the row with the smallest `x`.

### Does FIRST_VALUE need a custom frame?

Usually no. The default frame starts at the partition start. `LAST_VALUE` is the one that needs a custom frame.

### How do you get the first product per customer?

`FIRST_VALUE(product_name) OVER (PARTITION BY customer_id ORDER BY order_date, order_id)` plus `DISTINCT`, or `ROW_NUMBER() = 1`.

## Quick revision

- Value from the frame's first row.
- Default frame starts at partition start, so it just works.
- Returns any column, not just the sort key.
- Add tiebreakers.
- No `IGNORE NULLS` in PostgreSQL 16.
