---
title: OVER clause
slug: over
category: window-functions
difficulty: Intermediate
description: The OVER clause turns an aggregate or ranking function into a window function that computes per row without collapsing rows.
prerequisites: [group-by, sum, order-by]
related: [partition-by, window-order-by, running-totals, row-number]
questions: [105, 101, 13, 134]
patterns: [running-total, top-n-per-group]
guides: [window-functions]
minutes: 9
version: 1
---

## Introduction

`GROUP BY` collapses rows into one row per group. Often you want the detail rows **and** an aggregate next to them: each order with the customer's total, each product with its category average. `OVER` does exactly that.

## Definition

`OVER (...)` marks a function call as a **window function**. The function is evaluated for every input row over a *window* of related rows, and the result is attached to that row. Row count does not change.

## Why it matters

- Percent of total, running totals, rankings, previous/next row comparisons all need it.
- Interviewers use it to separate people who only know `GROUP BY` from people who can write analytical SQL.
- It replaces many self-joins and correlated subqueries with one pass.

## How it works

The window has three optional parts:

1. `PARTITION BY` splits rows into independent groups.
2. `ORDER BY` orders rows inside each partition.
3. A **frame** (`ROWS`/`RANGE`/`GROUPS BETWEEN ...`) picks which rows of the partition the function sees for the current row.

`OVER ()` with nothing inside means: one partition containing every row, no order, frame = whole partition.

Logical order: `FROM` → `WHERE` → `GROUP BY` → `HAVING` → **window functions** → `SELECT` list → `DISTINCT` → `ORDER BY` → `LIMIT`. So window functions see rows after grouping and filtering, and cannot be used in `WHERE` or `HAVING`.

## Syntax

```sql-syntax
function_name(args) OVER (
    [PARTITION BY expr, ...]
    [ORDER BY expr [ASC|DESC] [NULLS FIRST|LAST], ...]
    [frame_clause]
)

-- named window
SELECT f(x) OVER w, g(x) OVER w
FROM t
WINDOW w AS (PARTITION BY a ORDER BY b);
```

## Simple examples

Every product with the overall average price:

```sql
SELECT product_name,
       unit_price,
       ROUND(AVG(unit_price) OVER (), 2) AS avg_price
FROM products
ORDER BY product_id
LIMIT 5;
```

Count of rows without collapsing them:

```sql
SELECT order_id, order_date, COUNT(*) OVER () AS total_orders
FROM orders
ORDER BY order_id
LIMIT 5;
```

## Intermediate examples

Window over a grouped result: each customer's share of total revenue. The inner `SUM` is the aggregate, the outer `SUM(...) OVER ()` is the window.

```sql
SELECT o.customer_id,
       SUM(od.unit_price * od.quantity * (1 - od.discount)) AS revenue,
       ROUND(100.0 * SUM(od.unit_price * od.quantity * (1 - od.discount))::numeric
             / SUM(SUM(od.unit_price * od.quantity * (1 - od.discount))) OVER ()::numeric, 2) AS pct_of_total
FROM orders o
JOIN order_details od ON od.order_id = o.order_id
GROUP BY o.customer_id
ORDER BY revenue DESC
LIMIT 5;
```

## Advanced examples

Named window reused by several functions:

```sql
SELECT order_id, customer_id, order_date,
       ROW_NUMBER() OVER w AS nth_order,
       COUNT(*)     OVER w AS orders_so_far,
       SUM(freight) OVER w AS freight_so_far
FROM orders
WINDOW w AS (PARTITION BY customer_id ORDER BY order_date, order_id)
ORDER BY customer_id, order_date
LIMIT 8;
```

Filtering on a window result needs a subquery or CTE:

```sql
WITH t AS (
  SELECT product_name, unit_price, AVG(unit_price) OVER () AS avg_price
  FROM products
)
SELECT product_name, unit_price
FROM t
WHERE unit_price > avg_price
ORDER BY unit_price DESC;
```

## Real-world scenarios

- Percent of total sales per region or customer.
- Compare each row to a group or global average.
- Running balances, cumulative signups.
- Deduplicate by keeping row number 1.

## PostgreSQL specifics

- Any aggregate (built-in or user-defined) can be used with `OVER`.
- The `WINDOW` clause for named windows is supported; `OVER (w ORDER BY x)` can extend a named window that has no frame.
- `FILTER (WHERE ...)` works on aggregate window calls: `COUNT(*) FILTER (WHERE freight > 50) OVER ()`.
- PostgreSQL 16 has no `QUALIFY` clause; filter in an outer query.

## Visual explanation

```text
GROUP BY customer_id          SUM(freight) OVER (PARTITION BY customer_id)
+----------+-------+          +-------+----------+---------+-------+
| customer | sum   |          | order | customer | freight | sum   |
+----------+-------+          +-------+----------+---------+-------+
| A        | 30    |          | 1     | A        | 10      | 30    |
| B        | 5     |          | 2     | A        | 20      | 30    |
+----------+-------+          | 3     | B        | 5       | 5     |
 rows collapse                 rows kept, total repeated per row
```

## Common mistakes

- Putting a window function in `WHERE`: `ERROR: window functions are not allowed in WHERE`.
- Expecting `OVER (ORDER BY x)` to return a grand total. Adding `ORDER BY` changes the default frame to "start through current row" and gives a running total.
- Mixing up `SUM(SUM(x)) OVER ()` levels in grouped queries.
- Integer division in percent calculations; cast to numeric.

## Performance

- Each distinct window definition (partition + order) usually needs its own sort. Reuse one named window when you can.
- An index matching `PARTITION BY ... ORDER BY ...` can remove the sort.
- `OVER ()` is a single pass with no sort, but the whole result is buffered.

## Interview questions

### What is the difference between GROUP BY and a window function?

`GROUP BY` returns one row per group. A window function keeps every input row and adds a computed value per row.

### Can you use a window function in WHERE?

No. Window functions run after `WHERE`, `GROUP BY` and `HAVING`. Wrap the query in a CTE or subquery and filter outside.

### What does OVER () with empty parentheses mean?

The whole result set is one partition, unordered, and the frame is every row. Aggregates return the grand total on each row.

### Why does SUM(x) OVER (ORDER BY d) give a running total?

With `ORDER BY` the default frame is `RANGE BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW`, so each row sums from the partition start up to itself and its peers.

## Quick revision

- `OVER` = compute per row over related rows; no row collapse.
- Parts: `PARTITION BY`, `ORDER BY`, frame.
- `OVER ()` = whole result.
- Evaluated after `GROUP BY`/`HAVING`, before final `ORDER BY`/`LIMIT`.
- Not allowed in `WHERE`/`HAVING`; filter in an outer query.
- Use `WINDOW w AS (...)` to reuse definitions.
