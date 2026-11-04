---
title: CROSS JOIN
slug: cross-join
category: joins
difficulty: Beginner
description: SQL CROSS JOIN builds the Cartesian product of two tables. Use it for combination grids, scaffolding with generate_series, and attaching one-row totals.
prerequisites: [inner-join]
related: [inner-join, left-join, scalar-subqueries, join-cardinality, date-time-functions]
questions: [71, 72, 76, 50, 96]
patterns: [missing-records, pivot-report]
guides: [cross-join]
minutes: 6
version: 1
---

## Introduction

`CROSS JOIN` pairs every row of one table with every row of another. It has no join condition.

## Definition

`A CROSS JOIN B` returns the Cartesian product: `|A| × |B|` rows. It is equivalent to `A JOIN B ON TRUE` and to `FROM A, B`.

## Why it matters

It is the building block for "every combination" grids, for finding missing combinations, and for attaching a single-row aggregate (like a grand total) to every row. Accidental Cartesian products are also a classic bug.

## How it works

For each row of `A`, output it once per row of `B`. With 9 employees and 3 shippers you get 27 rows.

## Syntax

```sql-syntax
SELECT a.col, b.col
FROM table_a a
CROSS JOIN table_b b;
```

## Simple examples

Every employee-shipper combination:

```sql
SELECT e.first_name || ' ' || e.last_name AS employee, s.company_name AS shipper
FROM employees e
CROSS JOIN shippers s
ORDER BY employee, shipper
LIMIT 6;
```

Row count is the product:

```sql
SELECT (SELECT COUNT(*) FROM employees) * (SELECT COUNT(*) FROM shippers) AS expected,
       (SELECT COUNT(*) FROM employees CROSS JOIN shippers)                 AS actual;
```

## Intermediate examples

Attach a one-row aggregate to every row (share of total):

```sql
SELECT c.category_name,
       COUNT(*) AS products,
       ROUND(100.0 * COUNT(*) / t.total, 1) AS pct_of_products
FROM products p
JOIN categories c ON c.category_id = p.category_id
CROSS JOIN (SELECT COUNT(*) AS total FROM products) t
GROUP BY c.category_name, t.total
ORDER BY products DESC;
```

## Advanced examples

Scaffolding: build the full employee × shipper grid, then `LEFT JOIN` facts to find combinations with zero orders.

```sql
SELECT e.employee_id, s.shipper_id, COUNT(o.order_id) AS orders
FROM employees e
CROSS JOIN shippers s
LEFT JOIN orders o ON o.employee_id = e.employee_id AND o.ship_via = s.shipper_id
GROUP BY e.employee_id, s.shipper_id
ORDER BY orders, e.employee_id, s.shipper_id
LIMIT 6;
```

Calendar scaffolding with `generate_series` (PostgreSQL): every month in the order history, including months with no orders.

```sql
SELECT m.month::date AS month, COUNT(o.order_id) AS orders
FROM generate_series(
       (SELECT date_trunc('month', MIN(order_date)) FROM orders),
       (SELECT date_trunc('month', MAX(order_date)) FROM orders),
       interval '1 month') AS m(month)
LEFT JOIN orders o ON date_trunc('month', o.order_date) = m.month
GROUP BY m.month
ORDER BY m.month
LIMIT 8;
```

## Real-world scenarios

- Product × store grids for inventory or pricing.
- Date × entity scaffolds so reports show zero rows.
- Test-data generation.
- Comparing every row with a single benchmark row.

## PostgreSQL specifics

- `generate_series` (numbers, dates, timestamps) is a PostgreSQL set-returning function, often cross-joined.
- `CROSS JOIN LATERAL (subquery)` lets the subquery reference the outer row, which is useful for top-N per row.
- Comma syntax `FROM a, b` binds less tightly than explicit `JOIN`s, which can cause "missing FROM-clause entry" errors when mixed.

## Visual explanation

| employee | shipper |
|---|---|
| E1 | S1 |
| E1 | S2 |
| E1 | S3 |
| E2 | S1 |
| ... | ... |

9 employees × 3 shippers = 27 rows.

## Common mistakes

- Forgetting a join condition with comma syntax: an accidental Cartesian product.
- Cross-joining two large tables: the result explodes (10k × 10k = 100M rows).
- Adding an `ON` clause: `CROSS JOIN` takes none.
- Cross-joining a "single-row" subquery that actually returns several rows.

## Performance

Output size is the product of input sizes, so keep at least one side small (lookup table, one-row aggregate, generated series). Filtering after a large cross join is wasteful; use an inner join instead.

## Interview questions

### What does CROSS JOIN return?

Every combination of rows: |A| × |B| rows.

### How do you find combinations that never occurred?

Cross join the dimensions to build all combinations, then `LEFT JOIN` the facts and keep rows where the fact key is NULL (or count is 0).

### Is FROM a, b the same as CROSS JOIN?

Yes, unless a `WHERE` condition links them, which makes it an inner join.

### When is a CROSS JOIN safe on large data?

When one side has very few rows, such as a single-row aggregate or a small lookup table.

## Quick revision

- No `ON`; result = |A| × |B| rows.
- Use for grids, scaffolds and one-row totals.
- Cross join + `LEFT JOIN` finds missing combinations.
- `generate_series` builds date scaffolds in PostgreSQL.
- Accidental Cartesian products come from missing join conditions.
