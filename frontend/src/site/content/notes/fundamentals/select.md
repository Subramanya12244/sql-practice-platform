---
title: SELECT
slug: select
category: fundamentals
difficulty: Beginner
description: Learn SQL SELECT in PostgreSQL - choose columns, compute expressions, use aliases and casts, and avoid SELECT * in production queries.
prerequisites: [intro-to-sql]
related: [where, distinct, order-by, case, null-handling]
questions: [1, 120, 122, 128]
patterns: []
guides: [sql-order-of-execution]
minutes: 7
version: 1
---

## Introduction

`SELECT` defines the columns of a result. Each output column can be a stored column, a literal, or any expression built from functions and operators.

## Definition

`SELECT` projects a list of expressions over the rows produced by `FROM`, `WHERE`, `GROUP BY` and `HAVING`. Each expression can be renamed with `AS alias`.

## Why it matters

Every query starts here. Interviewers check that you compute derived values (revenue, full names, flags) correctly and name them clearly.

## How it works

For each row that survives filtering, PostgreSQL evaluates every expression in the select list. Aliases are assigned at this step. They are visible in `ORDER BY` but not in `WHERE`, `GROUP BY` expressions written earlier in logical order, or other select-list expressions.

## Syntax

```sql-syntax
SELECT expression [AS alias], ...
FROM table_name;

SELECT * FROM table_name;               -- all columns
SELECT t.column FROM table_name AS t;   -- table alias
```

## Simple examples

Pick columns:

```sql
SELECT product_name, unit_price
FROM products
LIMIT 5;
```

A `SELECT` without `FROM` works in PostgreSQL:

```sql
SELECT 2 + 3 AS result, 'hello' AS greeting;
```

## Intermediate examples

Computed columns and aliases. Line revenue = price × quantity × (1 − discount):

```sql
SELECT order_id,
       product_id,
       unit_price * quantity * (1 - discount) AS line_revenue
FROM order_details
LIMIT 5;
```

String concatenation and functions:

```sql
SELECT first_name || ' ' || last_name AS full_name,
       UPPER(LEFT(first_name, 1) || LEFT(last_name, 1)) AS initials
FROM employees;
```

## Advanced examples

Casting and rounding. `discount` is `REAL`, so the product is a float; cast to `numeric` before `ROUND(x, 2)`:

```sql
SELECT order_id,
       ROUND((unit_price * quantity * (1 - discount))::numeric, 2) AS line_revenue
FROM order_details
ORDER BY line_revenue DESC
LIMIT 5;
```

A boolean expression as a column:

```sql
SELECT product_name,
       units_in_stock,
       units_in_stock < reorder_level AS needs_reorder
FROM products
ORDER BY needs_reorder DESC, product_name
LIMIT 5;
```

## Real-world scenarios

- Building report columns: full name, revenue, margin, flags.
- Shaping API responses so the app does no extra work.
- Exporting only the columns a downstream team needs.

## PostgreSQL specifics

- `SELECT` without `FROM` is allowed in PostgreSQL; standard SQL and some databases need `FROM DUAL` or similar.
- `::type` is PostgreSQL cast shorthand; `CAST(x AS type)` is the standard form.
- `ROUND(value, digits)` takes `numeric`, not `double precision`.
- `||` returns NULL if any operand is NULL; `CONCAT()` treats NULL as an empty string.

## Visual explanation

```text
products row: (1, 'Chai', ..., unit_price 18.00, ...)
                    │
SELECT product_name, unit_price * 1.1 AS with_tax
                    ▼
result row:  ('Chai', 19.800)
```

## Common mistakes

- `SELECT *` in production code: breaks when columns change and reads more data than needed.
- Referring to an alias in `WHERE` or in another select expression.
- `ROUND(float_expr, 2)` fails in PostgreSQL: cast to `numeric` first.
- Forgetting that `'a' || NULL` is NULL.

## Performance

Selecting fewer columns reduces I/O and network transfer, and can allow index-only scans. Expressions in `SELECT` are cheap compared with joins and sorts.

## Interview questions

### Why avoid SELECT * in production?

It returns unneeded data, breaks callers when the schema changes, and blocks index-only scans.

### Can you use a column alias in WHERE?

No. `WHERE` is evaluated before `SELECT`. Repeat the expression, or wrap the query in a subquery or CTE.

### What is the difference between || and CONCAT in PostgreSQL?

`||` returns NULL when any operand is NULL. `CONCAT` skips NULL arguments.

### Why does ROUND(x, 2) sometimes fail in PostgreSQL?

The two-argument form only exists for `numeric`. A `real` or `double precision` value must be cast first.

## Quick revision

- `SELECT` lists expressions; `AS` names them.
- Aliases are usable in `ORDER BY`, not in `WHERE`.
- Cast with `::numeric` before `ROUND(x, 2)`.
- `||` propagates NULL; `CONCAT` does not.
- Avoid `SELECT *` outside exploration.
