---
title: LEAD
slug: lead
category: window-functions
difficulty: Intermediate
description: LEAD reads a value from a following row in the window order, used for time-to-next-event, validity ranges and next status.
prerequisites: [lag, partition-by]
related: [lag, last-value, date-time-functions]
questions: [153, 158]
patterns: [consecutive-dates, gaps-and-islands, earliest-latest-transactions]
guides: [lag-and-lead]
minutes: 6
version: 1
---

## Introduction

`LEAD` is the mirror of `LAG`: it looks forward. "How many days until this customer's next order?" is a `LEAD` question.

## Definition

`LEAD(expr [, offset [, default]])` returns `expr` from the row `offset` rows after the current row in its partition (default offset 1), or `default`/NULL when none exists.

## Why it matters

- Time to next event, churn detection.
- Building validity ranges (`valid_from`, `valid_to`) from a change log.

## How it works

Same as `LAG` but steps forward. `LEAD(x) OVER (ORDER BY k)` equals `LAG(x) OVER (ORDER BY k DESC)` for unique keys.

## Syntax

```sql-syntax
LEAD(expr [, offset [, default]]) OVER ([PARTITION BY p] ORDER BY k)
```

## Simple examples

```sql
SELECT order_id, order_date,
       LEAD(order_date) OVER (ORDER BY order_date, order_id) AS next_order_date
FROM orders
ORDER BY order_date, order_id
LIMIT 5;
```

## Intermediate examples

Days until next order per customer (question 104), with a named window:

```sql
SELECT customer_id, order_id, order_date,
       LEAD(order_date) OVER w AS next_date,
       LEAD(order_date) OVER w - order_date AS days_to_next
FROM orders
WINDOW w AS (PARTITION BY customer_id ORDER BY order_date, order_id)
ORDER BY customer_id, order_date
LIMIT 10;
```

## Advanced examples

Validity ranges for each customer's order: period during which it was the latest order.

```sql
SELECT customer_id, order_id,
       order_date AS valid_from,
       COALESCE(LEAD(order_date) OVER (PARTITION BY customer_id ORDER BY order_date, order_id) - 1,
                DATE '9999-12-31') AS valid_to
FROM orders
ORDER BY customer_id, order_date
LIMIT 8;
```

Customers whose last order was followed by nothing for the rest of the dataset (last order per customer via `LEAD IS NULL`):

```sql
SELECT customer_id, order_id, order_date
FROM (
  SELECT customer_id, order_id, order_date,
         LEAD(order_id) OVER (PARTITION BY customer_id ORDER BY order_date, order_id) AS nxt
  FROM orders
) t
WHERE nxt IS NULL
ORDER BY order_date
LIMIT 5;
```

## Real-world scenarios

- Next purchase interval for retention.
- Slowly changing dimension end dates.
- Next status in an order workflow.

## PostgreSQL specifics

- Date subtraction gives integer days.
- No `IGNORE NULLS` in PostgreSQL 16.

## Visual explanation

```text
order_date   LEAD(order_date)
2024-01-05   2024-02-10
2024-02-10   2024-03-01
2024-03-01   NULL
```

## Common mistakes

- Forgetting `PARTITION BY` so the last order of one customer points to another customer's order.
- Using `LAST_VALUE` when you mean "the next row" (`LEAD`).
- Ties on the order key give arbitrary "next" rows.

## Performance

Same as `LAG`: one sort per window definition.

## Interview questions

### How do you compute days until the next order per customer?

`LEAD(order_date) OVER (PARTITION BY customer_id ORDER BY order_date) - order_date`.

### LEAD vs LAG?

`LEAD` looks forward, `LAG` looks backward; otherwise identical signatures.

### How do you build valid_to from a change log?

`LEAD(valid_from) OVER (PARTITION BY key ORDER BY valid_from)` minus one unit, with a far-future default for the current row.

## Quick revision

- `LEAD(x, n, default)` = value n rows ahead.
- Last row(s) return NULL/default.
- Frame ignored.
- Great for time-to-next and validity ranges.
