---
title: String functions
slug: string-functions
category: advanced-sql
difficulty: Intermediate
description: Concatenate, search, split, clean and aggregate text in PostgreSQL with ||, CONCAT, LIKE, SPLIT_PART, REPLACE, regex and STRING_AGG.
prerequisites: [select, where, null-handling]
related: [date-time-functions, group-by, case, null-handling]
questions: [169, 170, 171, 172, 173, 174]
patterns: [find-duplicates]
guides: []
minutes: 9
version: 1
---

## Introduction

Real data has messy names, codes and free text. String functions let you build labels, match patterns, split fields and clean values directly in SQL.

## Definition

Functions and operators over `text`/`varchar`: concatenation (`||`, `CONCAT`), case (`UPPER`, `LOWER`, `INITCAP`), length (`LENGTH`), slicing (`LEFT`, `RIGHT`, `SUBSTRING`), search (`POSITION`, `LIKE`, `ILIKE`, `~`), splitting (`SPLIT_PART`, `string_to_array`), cleaning (`TRIM`, `REPLACE`, `REGEXP_REPLACE`) and aggregation (`STRING_AGG`).

## Why it matters

- Display columns: full names, initials, "City, Country".
- Filters: names starting with or containing something.
- Data cleaning before joining or de-duplicating.
- Interviews often test NULL behaviour of `||` vs `CONCAT`.

## How it works

- `a || b` returns NULL if either side is NULL. `CONCAT(a, b)` treats NULL as empty string.
- `LIKE` is case-sensitive; `%` matches any run of characters, `_` exactly one.
- `SUBSTRING(s FROM start FOR len)` is 1-based.
- `SPLIT_PART(s, delim, n)` returns the nth piece, or `''` if missing.
- `STRING_AGG(expr, sep ORDER BY ...)` concatenates values in a group.

## Syntax

```sql-syntax
first_name || ' ' || last_name
CONCAT(a, ' ', b)               CONCAT_WS(', ', a, b, c)
UPPER(s)  LOWER(s)  INITCAP(s)  LENGTH(s)
LEFT(s, n)  RIGHT(s, n)  SUBSTRING(s FROM i FOR n)
POSITION(' ' IN s)  SPLIT_PART(s, ' ', 2)
TRIM(s)  REPLACE(s, 'a', 'b')  REGEXP_REPLACE(s, pattern, repl, 'g')
s LIKE 'A%'   s ILIKE '%market%'   s ~ '^[0-9]+$'
STRING_AGG(col, ', ' ORDER BY col)
```

## Simple examples

Full name and initials:

```sql
SELECT first_name || ' ' || last_name           AS full_name,
       LEFT(first_name, 1) || LEFT(last_name, 1) AS initials,
       UPPER(last_name)                          AS last_upper
FROM employees
ORDER BY last_name;
```

Pattern matching (case-insensitive with `ILIKE`, which is PostgreSQL-only):

```sql
SELECT customer_id, company_name
FROM customers
WHERE company_name ILIKE '%market%'
   OR company_name LIKE 'B_r%';
```

## Intermediate examples

Split a contact name into first and last word:

```sql
SELECT contact_name,
       SPLIT_PART(contact_name, ' ', 1) AS first_word,
       SUBSTRING(contact_name FROM POSITION(' ' IN contact_name) + 1) AS rest
FROM customers
WHERE POSITION(' ' IN contact_name) > 0
LIMIT 5;
```

Longest product names:

```sql
SELECT product_name, LENGTH(product_name) AS len
FROM products
ORDER BY len DESC, product_name
LIMIT 5;
```

## Advanced examples

Product list per category with `STRING_AGG`:

```sql
SELECT c.category_name,
       COUNT(*) AS products,
       STRING_AGG(p.product_name, ', ' ORDER BY p.product_name) AS product_list
FROM categories c
JOIN products p ON p.category_id = c.category_id
GROUP BY c.category_name
ORDER BY c.category_name;
```

Validate and clean codes with regex:

```sql
SELECT customer_id, postal_code,
       postal_code ~ '^[0-9]+$'                   AS digits_only,
       REGEXP_REPLACE(postal_code, '[^0-9A-Za-z]', '', 'g') AS cleaned
FROM customers
WHERE postal_code IS NOT NULL
ORDER BY digits_only, customer_id
LIMIT 8;
```

NULL behaviour of `||` vs `CONCAT` (the `region` column is empty here):

```sql
SELECT customer_id,
       city || ', ' || region        AS with_pipes,
       CONCAT_WS(', ', city, region) AS with_concat_ws
FROM customers
LIMIT 3;
```

## Real-world scenarios

- Building mailing labels or display names.
- Normalising emails/codes (`LOWER(TRIM(email))`) before de-duplication.
- Parsing delimited fields from legacy imports.
- Comma-separated lists in reports with `STRING_AGG`.

## PostgreSQL specifics

- `ILIKE`, `~`, `~*`, `SPLIT_PART`, `STRING_AGG` and `REGEXP_*` are PostgreSQL. Standard SQL has `LIKE`, `SUBSTRING`, `POSITION`, `TRIM`, `||` and `LISTAGG`.
- MySQL uses `CONCAT` (its `||` is logical OR by default); SQL Server uses `+` and `STRING_AGG`.
- `LENGTH` counts characters; `OCTET_LENGTH` counts bytes.
- Comparisons and `ORDER BY` follow the database collation.

## Visual explanation

```text
contact_name = 'Maria Anders'
               123456789012
POSITION(' ' IN ..)          -> 6
LEFT(.., 5)                  -> 'Maria'
SUBSTRING(.. FROM 7)         -> 'Anders'
SPLIT_PART(.., ' ', 2)       -> 'Anders'
'Maria' || NULL              -> NULL
CONCAT('Maria', NULL)        -> 'Maria'
```

## Common mistakes

- Expecting `LIKE` to be case-insensitive (it is in MySQL's default collation, not in PostgreSQL).
- Losing whole values because one part of `||` is NULL.
- Off-by-one with 1-based `SUBSTRING`.
- Forgetting `ORDER BY` inside `STRING_AGG`, so the list order is arbitrary.
- `LIKE '%x%'` on a huge table and expecting an index to help.

## Performance

- A B-tree index serves `LIKE 'abc%'` only with the `C` collation or a `text_pattern_ops` index.
- Leading-wildcard searches (`'%abc%'`) need a trigram index (`pg_trgm` extension, GIN).
- `WHERE LOWER(email) = ...` needs an expression index on `LOWER(email)`.

## Interview questions

### What is the difference between `||` and `CONCAT`?

`||` returns NULL if any operand is NULL. `CONCAT` skips NULLs. `CONCAT_WS` also skips NULLs and their separators.

### How do you do a case-insensitive search?

In PostgreSQL, `ILIKE` or `LOWER(col) LIKE LOWER(pattern)`. The second is portable and can use an expression index.

### How do you turn rows into a comma-separated list?

`STRING_AGG(col, ', ' ORDER BY col)` with `GROUP BY`. Standard SQL calls it `LISTAGG`.

### How do you extract the last name from "First Last"?

`SPLIT_PART(name, ' ', 2)`, or `SUBSTRING(name FROM POSITION(' ' IN name) + 1)` to keep everything after the first space.

## Quick revision

- `||` propagates NULL; `CONCAT`/`CONCAT_WS` do not.
- `LIKE` case-sensitive; `ILIKE` is PostgreSQL's case-insensitive version.
- `%` any length, `_` one character.
- Strings are 1-based.
- `STRING_AGG(x, sep ORDER BY ...)` for lists.
- Leading `%` defeats B-tree indexes.
