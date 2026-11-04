---
title: Logical operators
slug: logical-operators
category: fundamentals
difficulty: Beginner
description: Combine SQL conditions with AND, OR and NOT, understand operator precedence and three-valued logic with NULL in PostgreSQL.
prerequisites: [where, comparison-operators]
related: [where, comparison-operators, null-handling, case, in-not-in]
questions: [163, 170, 177, 179]
patterns: []
guides: []
minutes: 6
version: 1
---

## Introduction

`AND`, `OR` and `NOT` combine conditions. They look simple, but precedence and NULL handling cause many subtle bugs.

## Definition

- `a AND b`: true only when both are true.
- `a OR b`: true when at least one is true.
- `NOT a`: inverts true and false; `NOT NULL` stays NULL.

SQL uses **three-valued logic**: TRUE, FALSE and NULL (unknown).

## Why it matters

A missing pair of parentheses changes the answer without any error. Interviewers like `NOT IN` and NULL truth-table questions.

## How it works

Precedence: `NOT` binds tightest, then `AND`, then `OR`. So `a OR b AND c` means `a OR (b AND c)`. PostgreSQL does not guarantee left-to-right short-circuit evaluation, so do not rely on order to avoid errors (use `CASE` for that).

## Syntax

```sql-syntax
WHERE cond1 AND cond2
WHERE cond1 OR cond2
WHERE NOT cond
WHERE (cond1 OR cond2) AND cond3
```

## Simple examples

```sql
SELECT product_name, unit_price, units_in_stock
FROM products
WHERE unit_price > 30 AND units_in_stock > 0
ORDER BY unit_price DESC;
```

```sql
SELECT company_name, country
FROM customers
WHERE country = 'UK' OR country = 'Ireland'
ORDER BY country, company_name;
```

## Intermediate examples

Parentheses matter. Without them, this would return every discontinued product regardless of price:

```sql
SELECT product_name, unit_price, discontinued
FROM products
WHERE (category_id = 1 OR discontinued)
  AND unit_price < 20
ORDER BY product_name;
```

`NOT` with booleans and patterns:

```sql
SELECT product_name
FROM products
WHERE NOT discontinued
  AND product_name NOT LIKE 'C%'
ORDER BY product_name
LIMIT 5;
```

## Advanced examples

Three-valued logic in action. `shipped_date > required_date` is NULL for unshipped orders, so neither the condition nor its `NOT` keeps them:

```sql
SELECT COUNT(*) FILTER (WHERE shipped_date > required_date)        AS late,
       COUNT(*) FILTER (WHERE NOT (shipped_date > required_date))  AS not_late,
       COUNT(*) FILTER (WHERE shipped_date IS NULL)                AS unknown,
       COUNT(*)                                                    AS total
FROM orders;
```

`IS TRUE` / `IS NOT TRUE` turn NULL into a definite answer:

```sql
SELECT COUNT(*) AS not_late_or_unknown
FROM orders
WHERE (shipped_date > required_date) IS NOT TRUE;
```

## Real-world scenarios

- Combining user-selected filters (`status = ... AND region IN ...`).
- Exclusion rules: "active and (VIP or recent buyer)".
- Data-quality checks that must count unknowns separately.

## PostgreSQL specifics

- Boolean columns can be used directly: `WHERE discontinued`, `WHERE NOT discontinued`.
- `IS TRUE`, `IS FALSE`, `IS UNKNOWN` (and their `NOT` forms) never return NULL.
- The planner may reorder `AND`/`OR` operands; do not depend on short-circuiting.

## Visual explanation

| a | b | a AND b | a OR b | NOT a |
|---|---|---|---|---|
| T | T | T | T | F |
| T | F | F | T | F |
| T | NULL | NULL | T | F |
| F | NULL | F | NULL | T |
| NULL | NULL | NULL | NULL | NULL |

## Common mistakes

- `a OR b AND c` read as `(a OR b) AND c`.
- Expecting `NOT (x > y)` to return rows where x or y is NULL.
- `NOT IN` with a NULL in the list returns no rows.
- Long `OR` chains on one column; `IN (...)` is clearer.

## Performance

`AND` conditions can each use an index, or be combined via bitmap scans. `OR` across different columns can prevent a single index scan; PostgreSQL may use a BitmapOr, or a `UNION` rewrite can be faster.

## Interview questions

### What is the precedence of AND, OR and NOT?

`NOT` first, then `AND`, then `OR`. Use parentheses to be explicit.

### What is TRUE AND NULL? TRUE OR NULL?

`TRUE AND NULL` is NULL. `TRUE OR NULL` is TRUE.

### Why can NOT (condition) miss rows?

When the condition is NULL, `NOT NULL` is still NULL, so `WHERE` discards the row.

### Does PostgreSQL short-circuit AND/OR?

Not reliably. Use `CASE` when evaluation order matters, for example to avoid division by zero.

## Quick revision

- Precedence: NOT, AND, OR.
- Always parenthesise mixed AND/OR.
- Three-valued logic: NULL is "unknown".
- `NOT NULL` is NULL, so negations skip NULL rows.
- `IS TRUE` / `IS NOT TRUE` remove the unknown case.
