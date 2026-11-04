---
title: LAG
slug: lag
category: window-functions
difficulty: Intermediate
description: LAG reads a value from a previous row in the window order, used for period-over-period change, gaps between events and streaks.
prerequisites: [over, partition-by, window-order-by]
related: [lead, first-value, running-totals, date-time-functions]
questions: [152, 158, 166]
patterns: [month-over-month-growth, year-over-year-growth, consecutive-dates, gaps-and-islands]
guides: [lag-and-lead, year-over-year-growth, gaps-and-islands]
minutes: 8
version: 1
---

## Introduction

`LAG` lets a row look backward: "what was last month's revenue?" or "when was this customer's previous order?" without a self-join.

## Definition

`LAG(expr [, offset [, default]])` returns `expr` evaluated on the row `offset` rows before the current row in its partition (offset defaults to 1). If there is no such row, it returns `default` (NULL if omitted).

## Why it matters

- Month-over-month and year-over-year growth.
- Time between events per user.
- Detecting changes and streak starts.

## How it works

1. Partition and order rows.
2. For each row, step back `offset` physical rows within the partition.
3. Frame is ignored; only the order matters.

## Syntax

```sql-syntax
LAG(expr [, offset [, default]]) OVER ([PARTITION BY p] ORDER BY k)
```

## Simple examples

```sql
SELECT order_id, order_date,
       LAG(order_date) OVER (ORDER BY order_date, order_id) AS prev_order_date
FROM orders
ORDER BY order_date, order_id
LIMIT 5;
```

## Intermediate examples

Month-over-month revenue change (question 103):

```sql
WITH m AS (
  SELECT DATE_TRUNC('month', o.order_date)::date AS month,
         SUM(od.unit_price * od.quantity * (1 - od.discount))::numeric AS revenue
  FROM orders o
  JOIN order_details od ON od.order_id = o.order_id
  GROUP BY 1
)
SELECT month,
       ROUND(revenue, 2) AS revenue,
       ROUND(LAG(revenue) OVER (ORDER BY month), 2) AS prev_revenue,
       ROUND(100 * (revenue - LAG(revenue) OVER (ORDER BY month))
             / NULLIF(LAG(revenue) OVER (ORDER BY month), 0), 1) AS pct_change
FROM m
ORDER BY month
LIMIT 8;
```

## Advanced examples

Days since previous order per employee, then average gap (question 109):

```sql
WITH g AS (
  SELECT employee_id, order_date,
         order_date - LAG(order_date) OVER (PARTITION BY employee_id
                                            ORDER BY order_date, order_id) AS gap_days
  FROM orders
  WHERE employee_id IS NOT NULL
)
SELECT employee_id, ROUND(AVG(gap_days), 1) AS avg_gap_days
FROM g
GROUP BY employee_id
ORDER BY employee_id;
```

Offset and default: compare with two orders back, 0 when missing.

```sql
SELECT order_id, freight,
       LAG(freight, 2, 0) OVER (ORDER BY order_id) AS freight_2_back
FROM orders
ORDER BY order_id
LIMIT 5;
```

## Real-world scenarios

- Revenue growth dashboards.
- Session gaps and churn signals.
- Stock price daily change.

## PostgreSQL specifics

- `date - date` returns an integer number of days; `timestamp - timestamp` returns an interval.
- PostgreSQL 16 does not support `IGNORE NULLS` for `LAG`; use a filtered subquery or a grouping trick.
- The `default` must be type-compatible with `expr`.

## Visual explanation

```text
month   revenue  LAG(revenue)
Jan     100      NULL
Feb     120      100
Mar     90       120
```

## Common mistakes

- Missing `PARTITION BY`: the first row of a customer reads the previous customer's value.
- Non-unique order: `LAG` over tied dates picks an arbitrary previous row.
- Division by zero in growth; wrap in `NULLIF(prev, 0)`.
- Missing months in the data make `LAG` compare non-adjacent periods. Generate a calendar with `generate_series` if gaps matter.

## Performance

One sort per window; cheaper than a self-join on "previous row" conditions. Reuse a named window for several `LAG` calls.

## Interview questions

### How do you compute month-over-month growth?

Aggregate per month, then `(rev - LAG(rev) OVER (ORDER BY month)) / NULLIF(LAG(rev) OVER (ORDER BY month), 0)`.

### What does LAG return for the first row?

NULL, or the third argument if given.

### Does the frame affect LAG?

No. `LAG` and `LEAD` work on row offsets within the partition and ignore the frame.

## Quick revision

- `LAG(x, n, default)` = value n rows back.
- First row(s) return NULL/default.
- Partition to avoid leaking across groups.
- Frame ignored.
- Use `NULLIF` for percent change.
