---
title: ORDER BY in windows and frames
slug: window-order-by
category: window-functions
difficulty: Advanced
description: How ORDER BY inside OVER sets row order, peers and the default frame, and how ROWS, RANGE and GROUPS frames differ in PostgreSQL.
prerequisites: [over, partition-by, order-by]
related: [running-totals, moving-averages, last-value, first-value]
questions: [101, 102, 107, 119]
patterns: [running-total, moving-average]
guides: [window-functions, running-total]
minutes: 12
version: 1
---

## Introduction

`ORDER BY` inside `OVER` does two jobs: it orders rows for ranking and offset functions, and it changes the **frame** used by aggregates and `FIRST_VALUE`/`LAST_VALUE`. Most window-function bugs come from the frame.

## Definition

- **Window ORDER BY**: the order of rows within each partition. Rows with equal sort keys are **peers**.
- **Frame**: the subset of the partition visible to the function for the current row. Defined with `ROWS`, `RANGE` or `GROUPS`.

## Why it matters

- Running totals, moving averages and "last value" all depend on the frame.
- The default frame silently includes peers, so ties change results.
- Interviewers often ask why `LAST_VALUE` "doesn't work".

## How it works

Default frames:

| Window | Default frame |
|---|---|
| no `ORDER BY` | whole partition |
| with `ORDER BY` | `RANGE BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW` |

Frame modes:

- `ROWS`: offsets count physical rows. `CURRENT ROW` is just this row.
- `RANGE`: offsets are value distances on the single `ORDER BY` key. `CURRENT ROW` means this row **and all its peers**.
- `GROUPS`: offsets count peer groups. `1 PRECEDING` = the previous set of tied rows.

Bounds: `UNBOUNDED PRECEDING`, `n PRECEDING`, `CURRENT ROW`, `n FOLLOWING`, `UNBOUNDED FOLLOWING`.

Ranking (`ROW_NUMBER`, `RANK`, `DENSE_RANK`) and offset functions (`LAG`, `LEAD`) ignore the frame. Aggregates, `FIRST_VALUE`, `LAST_VALUE` and `NTH_VALUE` use it.

## Syntax

```sql-syntax
OVER (
  [PARTITION BY ...]
  ORDER BY key [ASC|DESC] [NULLS FIRST|LAST]
  { ROWS | RANGE | GROUPS }
    BETWEEN frame_start AND frame_end
  [ EXCLUDE { CURRENT ROW | GROUP | TIES | NO OTHERS } ]
)

frame_start / frame_end:
  UNBOUNDED PRECEDING | offset PRECEDING | CURRENT ROW
  | offset FOLLOWING | UNBOUNDED FOLLOWING
```

## Simple examples

Default frame vs `ROWS`. Many orders share an `order_date`; with the default `RANGE` frame all same-day orders get the same running total.

```sql
SELECT order_id, order_date, freight,
       SUM(freight) OVER (ORDER BY order_date) AS range_default,
       SUM(freight) OVER (ORDER BY order_date
                          ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW) AS rows_frame
FROM orders
ORDER BY order_date, order_id
LIMIT 10;
```

## Intermediate examples

`ROWS`, `RANGE` and `GROUPS` side by side on product prices (prices have ties):

```sql
SELECT product_name, unit_price,
       COUNT(*) OVER (ORDER BY unit_price ROWS   BETWEEN 1 PRECEDING AND CURRENT ROW) AS rows_cnt,
       COUNT(*) OVER (ORDER BY unit_price RANGE  BETWEEN 1 PRECEDING AND CURRENT ROW) AS range_cnt,
       COUNT(*) OVER (ORDER BY unit_price GROUPS BETWEEN 1 PRECEDING AND CURRENT ROW) AS groups_cnt
FROM products
ORDER BY unit_price
LIMIT 10;
```

- `rows_cnt`: at most 2 (previous row + current).
- `range_cnt`: all rows priced within 1.00 below the current price, plus peers.
- `groups_cnt`: current price group + previous distinct price group.

## Advanced examples

`RANGE` with an interval: freight in the 7 days up to and including each order date.

```sql
SELECT order_id, order_date, freight,
       SUM(freight) OVER (ORDER BY order_date
                          RANGE BETWEEN INTERVAL '6 days' PRECEDING AND CURRENT ROW) AS freight_7d
FROM orders
ORDER BY order_date, order_id
LIMIT 10;
```

`EXCLUDE CURRENT ROW`: average price of the other products in the category.

```sql
SELECT product_name, category_id, unit_price,
       ROUND(AVG(unit_price) OVER (PARTITION BY category_id ORDER BY unit_price
             ROWS BETWEEN UNBOUNDED PRECEDING AND UNBOUNDED FOLLOWING
             EXCLUDE CURRENT ROW), 2) AS avg_of_others
FROM products
ORDER BY category_id, unit_price
LIMIT 8;
```

## Real-world scenarios

- Cumulative revenue (`ROWS UNBOUNDED PRECEDING`).
- Rolling 7-day or 30-day metrics on dates (`RANGE INTERVAL`).
- Last N rows moving average (`ROWS n PRECEDING`).
- Comparing with tied rows as a block (`GROUPS`).

## PostgreSQL specifics

- `GROUPS` mode, `RANGE` with an offset and `EXCLUDE` were added in PostgreSQL 11.
- `RANGE` with an offset requires exactly one `ORDER BY` column of a type that supports addition (numeric, date, timestamp with interval offsets).
- Frame end cannot come before frame start (e.g. `BETWEEN CURRENT ROW AND 1 PRECEDING` is an error).
- `ROWS UNBOUNDED PRECEDING` is shorthand for `ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW`.

## Visual explanation

```text
sorted rows:   10   20   20   20   30
current row:             ^ (2nd 20)

ROWS   1 PRECEDING..CURRENT   ->  20 20          (2 rows)
RANGE  10 PRECEDING..CURRENT  ->  10 20 20 20    (values 10..20, all peers)
GROUPS 1 PRECEDING..CURRENT   ->  10 20 20 20    (prev group + peer group)
default RANGE UNBOUNDED..CURR ->  10 20 20 20    (peers of 20 included)
```

## Common mistakes

- Relying on the default frame for running totals when the order key has ties. Use `ROWS` or add a unique tiebreaker.
- `LAST_VALUE(x) OVER (ORDER BY y)` returns the current row's (last peer's) value, because the frame ends at the current row.
- Non-deterministic order: `ORDER BY order_date` alone with ties makes `ROW_NUMBER` arbitrary among ties.
- Expecting the window `ORDER BY` to sort the output. Add a final `ORDER BY`.

## Performance

- `ROWS` frames are cheapest to reason about; PostgreSQL computes sliding aggregates incrementally for many built-in aggregates when the frame start moves.
- `RANGE`/`GROUPS` require peer detection but are similar cost.
- An index on `(partition_key, order_key)` can avoid the sort.

## Interview questions

### What is the default window frame?

Without `ORDER BY`: the whole partition. With `ORDER BY`: `RANGE BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW`, which includes all peers of the current row.

### ROWS vs RANGE?

`ROWS` counts physical rows. `RANGE` works on values of the sort key; `CURRENT ROW` includes ties, and offsets are value distances like `INTERVAL '7 days'`.

### What is GROUPS mode?

Offsets count peer groups (sets of tied rows). `GROUPS BETWEEN 1 PRECEDING AND CURRENT ROW` covers the previous distinct key value and the current one.

### Which functions ignore the frame?

`ROW_NUMBER`, `RANK`, `DENSE_RANK`, `PERCENT_RANK`, `CUME_DIST`, `NTILE`, `LAG` and `LEAD`.

## Quick revision

- Window `ORDER BY` sets order and peers, not output order.
- Default frame with `ORDER BY` = `RANGE UNBOUNDED PRECEDING .. CURRENT ROW` (peers included).
- `ROWS` = physical rows; `RANGE` = value distance; `GROUPS` = peer groups.
- Use `ROWS` for running totals with ties.
- `LAST_VALUE` needs `... AND UNBOUNDED FOLLOWING`.
- `EXCLUDE`, `GROUPS`, `RANGE` offsets: PostgreSQL 11+.
