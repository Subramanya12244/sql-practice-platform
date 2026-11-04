---
title: Comparison operators
slug: comparison-operators
category: fundamentals
difficulty: Beginner
description: SQL comparison operators in PostgreSQL - =, <>, <, >, BETWEEN, IN, LIKE, ILIKE, IS NULL and IS DISTINCT FROM, with NULL behaviour explained.
prerequisites: [where]
related: [where, logical-operators, null-handling, in-not-in, string-functions]
questions: [112, 114, 121, 124]
patterns: []
guides: [null-handling-coalesce]
minutes: 7
version: 1
---

## Introduction

Comparison operators build the conditions used in `WHERE`, `ON`, `HAVING` and `CASE`. Each returns TRUE, FALSE or NULL.

## Definition

| Operator | Meaning |
|---|---|
| `=`, `<>` (or `!=`) | equal, not equal |
| `<`, `<=`, `>`, `>=` | ordering |
| `BETWEEN a AND b` | `>= a AND <= b` (inclusive) |
| `IN (...)` | equals any value in a list |
| `LIKE`, `ILIKE` | pattern match (`%` any string, `_` one character) |
| `IS NULL`, `IS NOT NULL` | NULL test |
| `IS DISTINCT FROM` | NULL-safe not-equal |

## Why it matters

Most wrong answers in interviews come from small comparison errors: inclusive `BETWEEN`, `NOT IN` with NULLs, or case-sensitive `LIKE`.

## How it works

Values must have comparable types; PostgreSQL casts implicitly where it can. If either side is NULL, `=`, `<>`, `<`, `>` and `LIKE` return NULL, and `WHERE` treats NULL as not true.

## Syntax

```sql-syntax
expr = expr
expr <> expr
expr BETWEEN low AND high
expr IN (v1, v2, ...)
expr LIKE 'pattern'      -- case-sensitive
expr ILIKE 'pattern'     -- PostgreSQL, case-insensitive
expr IS [NOT] NULL
expr IS [NOT] DISTINCT FROM expr
```

## Simple examples

```sql
SELECT product_name, unit_price
FROM products
WHERE unit_price BETWEEN 10 AND 20
ORDER BY unit_price;
```

```sql
SELECT company_name, country
FROM customers
WHERE country <> 'USA'
ORDER BY company_name
LIMIT 5;
```

## Intermediate examples

Patterns: names starting with "B", and names whose second letter is "a".

```sql
SELECT company_name
FROM customers
WHERE company_name LIKE 'B%'
   OR company_name ILIKE '_a%'
ORDER BY company_name;
```

Lists:

```sql
SELECT order_id, ship_via
FROM orders
WHERE ship_via IN (1, 3)
ORDER BY order_id
LIMIT 5;
```

## Advanced examples

NULL-safe comparison. `employee_id <> 1` drops the order with a NULL employee; `IS DISTINCT FROM` keeps it.

```sql
SELECT COUNT(*) FILTER (WHERE employee_id <> 1)                 AS plain_not_equal,
       COUNT(*) FILTER (WHERE employee_id IS DISTINCT FROM 1)   AS null_safe_not_equal
FROM orders;
```

Regular expressions (PostgreSQL): postal codes that are purely digits.

```sql
SELECT customer_id, postal_code
FROM customers
WHERE postal_code ~ '^[0-9]+$'
LIMIT 5;
```

Row-value comparison compares left to right:

```sql
SELECT order_id, customer_id
FROM orders
WHERE (customer_id, order_id) > ('VINET', 0)
ORDER BY customer_id, order_id
LIMIT 5;
```

## Real-world scenarios

- Price bands and date windows with `>=` / `<`.
- Search with `ILIKE '%term%'`.
- Change detection: `old_value IS DISTINCT FROM new_value`.

## PostgreSQL specifics

- `ILIKE`, `~`, `~*` and `!~` are PostgreSQL operators.
- `IS DISTINCT FROM` is standard SQL but missing in some databases (MySQL uses `<=>`).
- `BETWEEN SYMMETRIC` accepts the bounds in either order.

## Visual explanation

| a | b | `a = b` | `a <> b` | `a IS DISTINCT FROM b` |
|---|---|---|---|---|
| 1 | 1 | true | false | false |
| 1 | 2 | false | true | true |
| 1 | NULL | NULL | NULL | true |
| NULL | NULL | NULL | NULL | false |

## Common mistakes

- `= NULL` / `<> NULL`: always NULL.
- `BETWEEN` is inclusive on both ends, which double-counts at boundaries and misses timestamps on the last day.
- `NOT IN (subquery)` returns nothing if the subquery yields a NULL.
- `LIKE` is case-sensitive in PostgreSQL.
- Comparing numbers stored as text: `'10' < '9'` is true as text.

## Performance

Equality and range comparisons on a bare column can use B-tree indexes. `LIKE 'abc%'` can use an index with `text_pattern_ops` or the C collation; `LIKE '%abc'` cannot use a B-tree index (consider `pg_trgm`). Functions on the column (`LOWER(col) = ...`) need an expression index.

## Interview questions

### Is BETWEEN inclusive?

Yes, on both ends. `x BETWEEN 1 AND 5` equals `x >= 1 AND x <= 5`.

### What does NULL = NULL return?

NULL, not TRUE. Use `IS NULL` or `IS NOT DISTINCT FROM`.

### How do you do a case-insensitive match in PostgreSQL?

`ILIKE`, `LOWER(col) = LOWER(value)`, or the `citext` type.

### What is IS DISTINCT FROM used for?

Comparing values where NULL should be treated as a normal value, such as detecting changed columns.

## Quick revision

- Comparisons with NULL return NULL.
- `BETWEEN` is inclusive; prefer `>= low AND < high` for dates.
- `LIKE` is case-sensitive; `ILIKE` is not (PostgreSQL).
- `%` matches any string, `_` exactly one character.
- `IS DISTINCT FROM` is the NULL-safe `<>`.
