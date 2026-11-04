---
title: Join cardinality
slug: join-cardinality
category: joins
difficulty: Advanced
description: Predict SQL join row counts - one-to-one, one-to-many and many-to-many joins, fan-out, double counting, and how to check grain before aggregating.
prerequisites: [inner-join, left-join, group-by]
related: [multiple-joins, join-vs-subquery, primary-foreign-keys, cte, distinct]
questions: [1, 6, 31, 40, 55]
patterns: [find-duplicates]
guides: []
minutes: 8
version: 1
---

## Introduction

Before writing a join, ask "how many rows will come out?". Getting this wrong is the most common source of inflated totals.

## Definition

**Cardinality** describes how many rows on one side match a row on the other:

- **One-to-one**: each row matches at most one row.
- **One-to-many**: a parent row (order) matches many child rows (order lines).
- **Many-to-many**: both sides have repeats of the key; result rows = sum over keys of (left count × right count).

The **grain** of a result is what one row represents (one order, one order line, one customer-month).

## Why it matters

Joins multiply rows. Summing a value from the "one" side after joining to the "many" side counts it many times. Interviewers love asking why a total is too high.

## How it works

For an equality join on key `k`, output rows for each key = (left rows with `k`) × (right rows with `k`). Joining from the many side to a unique key (many-to-one) never increases the row count.

## Syntax

```sql-syntax
-- check uniqueness of a join key before joining
SELECT key_col, COUNT(*)
FROM table_name
GROUP BY key_col
HAVING COUNT(*) > 1;
```

## Simple examples

Row counts of each table versus the join:

```sql
SELECT (SELECT COUNT(*) FROM orders)                                             AS orders,
       (SELECT COUNT(*) FROM order_details)                                      AS order_lines,
       (SELECT COUNT(*) FROM orders o JOIN order_details od USING (order_id))    AS joined_rows;
```

The join has one row per order line: the grain changed from order to order line.

## Intermediate examples

Fan-out bug: freight is per order, but after joining lines it is summed once per line.

```sql
SELECT ROUND(SUM(o.freight), 2)                          AS wrong_total_freight,
       (SELECT ROUND(SUM(freight), 2) FROM orders)       AS correct_total_freight
FROM orders o
JOIN order_details od ON od.order_id = o.order_id;
```

Check whether a key is unique before trusting a join to it:

```sql
SELECT order_id, COUNT(*) AS lines
FROM order_details
GROUP BY order_id
HAVING COUNT(*) > 1
ORDER BY lines DESC
LIMIT 5;
```

## Advanced examples

Many-to-many explosion: joining customers to suppliers through `country` multiplies rows per country.

```sql
SELECT c.country,
       COUNT(DISTINCT c.customer_id) AS customers,
       COUNT(DISTINCT s.supplier_id) AS suppliers,
       COUNT(*)                      AS joined_rows
FROM customers c
JOIN suppliers s ON s.country = c.country
GROUP BY c.country
ORDER BY joined_rows DESC
LIMIT 5;
```

Fix: aggregate each side to the target grain, then join one-to-one.

```sql
WITH cust AS (SELECT country, COUNT(*) AS customers FROM customers GROUP BY country),
     supp AS (SELECT country, COUNT(*) AS suppliers FROM suppliers GROUP BY country)
SELECT cust.country, cust.customers, supp.suppliers
FROM cust
JOIN supp ON supp.country = cust.country
ORDER BY cust.customers DESC
LIMIT 5;
```

## Real-world scenarios

- Dashboard totals that do not match finance: often a fan-out.
- Joining two event tables on user id (many-to-many) and counting events.
- Validating ETL output by comparing row counts before and after each join.

## PostgreSQL specifics

- A `PRIMARY KEY` or `UNIQUE` constraint guarantees the "one" side; PostgreSQL uses this to remove unneeded left joins.
- `COUNT(DISTINCT ...)` hides fan-out for counts but not for sums.
- `EXPLAIN ANALYZE` shows estimated vs actual rows for each join node.

## Visual explanation

| relationship | example | output rows |
|---|---|---|
| many-to-one | order_details → products | = order lines |
| one-to-many | orders → order_details | = order lines (orders repeat) |
| many-to-many | customers ↔ suppliers on country | Σ customers × suppliers per country |
| one-to-one | orders ↔ per-order revenue CTE | = orders |

## Common mistakes

- Summing parent columns after joining children.
- Using `DISTINCT` or `SUM(DISTINCT x)` to "fix" totals: it also removes genuinely equal values.
- Joining on non-unique attributes (name, country) believing they are keys.
- Not checking the row count after each join step.

## Performance

Fan-out inflates intermediate results, which costs memory and time even when a later `DISTINCT` hides it. Pre-aggregating to the target grain keeps joins small and correct.

## Interview questions

### Why is my SUM too large after a join?

The join is one-to-many or many-to-many, so each value is repeated once per matching row. Aggregate before joining.

### How many rows does a many-to-many join return?

For each key, left count × right count; the total is the sum over all keys.

### Does a many-to-one join change the row count?

No, provided the "one" side's key is unique and every row matches (or you use `LEFT JOIN`).

### Is SUM(DISTINCT freight) a valid fix?

No. Two different orders with the same freight would be counted once. Fix the grain instead.

## Quick revision

- Decide the grain of the result first.
- Rows per key = left count × right count.
- Many-to-one from the fact table is safe.
- Pre-aggregate parent and child measures separately.
- Verify key uniqueness with `GROUP BY ... HAVING COUNT(*) > 1`.
- `DISTINCT` is not a fix for fan-out.
