---
title: UNION
slug: union
category: set-operators
difficulty: Beginner
description: Stack the results of two queries into one list and remove duplicate rows with SQL UNION, with PostgreSQL examples on Northwind.
prerequisites: [select, distinct]
related: [union-all, intersect, except, full-outer-join]
questions: [79, 80, 81, 82, 83, 85]
patterns: []
guides: [union-vs-union-all]
minutes: 7
version: 1
---

## Introduction

A JOIN adds columns side by side. `UNION` adds rows: it stacks the result of one query on top of another. It also removes duplicate rows from the combined result.

## Definition

`query1 UNION query2` returns every distinct row that appears in either query. Both queries must return the same number of columns, and matching columns must have compatible types.

## Why it matters

- Build one list from several tables, such as a contact directory of customers, suppliers and employees.
- Merge data that has the same shape but lives in different places.
- Interviewers often ask how it differs from `UNION ALL` and from a JOIN.

## How it works

1. PostgreSQL runs each `SELECT` on its own.
2. It appends the rows, matching columns by position, not by name.
3. It removes duplicate rows, usually with a hash or sort step.
4. It applies a final `ORDER BY` or `LIMIT`, if one is present, to the whole result.

Column names come from the first query.

## Syntax

```sql-syntax
SELECT col1, col2 FROM table_a
UNION
SELECT col1, col2 FROM table_b
ORDER BY col1;
```

## Simple examples

Every country that has a customer or a supplier. Each country appears once:

```sql
SELECT country FROM customers
UNION
SELECT country FROM suppliers
ORDER BY country;
```

Product and category names in one list:

```sql
SELECT product_name AS name FROM products
UNION
SELECT category_name FROM categories
ORDER BY name
LIMIT 10;
```

## Intermediate examples

Add a literal column to label where each row came from. The label makes otherwise equal rows different, so they survive deduplication:

```sql
SELECT company_name, 'Customer' AS kind FROM customers
UNION
SELECT company_name, 'Supplier' FROM suppliers
ORDER BY kind, company_name
LIMIT 10;
```

Three-way UNION. Employees have no company name, so build the name from first and last name:

```sql
SELECT contact_name AS person, 'Customer' AS kind FROM customers
UNION
SELECT contact_name, 'Supplier' FROM suppliers
UNION
SELECT first_name || ' ' || last_name, 'Employee' FROM employees
ORDER BY kind, person
LIMIT 10;
```

## Advanced examples

Wrap a UNION in a CTE, then aggregate it. Count distinct cities per country across customers and suppliers:

```sql
WITH locations AS (
  SELECT country, city FROM customers
  UNION
  SELECT country, city FROM suppliers
)
SELECT country, COUNT(*) AS cities
FROM locations
GROUP BY country
ORDER BY cities DESC, country
LIMIT 5;
```

Align types and fill missing columns. `customer_id` is text but `employee_id` is an integer, so cast it. Employees have no company, so use a typed `NULL` placeholder:

```sql
SELECT customer_id AS id, company_name AS company, contact_name AS name FROM customers
UNION
SELECT employee_id::text, NULL::varchar, first_name || ' ' || last_name FROM employees
ORDER BY name
LIMIT 5;
```

## Real-world scenarios

- Master contact or company directories built from several source tables.
- Combining current and archived tables with the same layout.
- Listing every distinct key that appears in any of several tables.

## PostgreSQL specifics

- In PostgreSQL, `UNION` treats two NULLs as equal when it removes duplicates, unlike `=`.
- Type resolution follows the `UNION` rules: an untyped `NULL` or literal takes its type from the other branches. Cast explicitly when types differ, e.g. `customer_id::text`.
- `ORDER BY` after the last branch sorts the whole result. To sort or limit one branch, put it in parentheses: `(SELECT ... ORDER BY ... LIMIT 3)`.

## Visual explanation

```text
customers.country     suppliers.country        UNION
-----------------     -----------------     ----------
Germany               Germany               Germany
Mexico                Japan          ==>    Japan
Germany               USA                   Mexico
                                            USA
(duplicates across and within both sides are removed)
```

## Common mistakes

- Different column counts in the branches: PostgreSQL raises `each UNION query must have the same number of columns`.
- Columns in a different order. Matching is by position, so names go into the wrong column silently.
- Using `UNION` when duplicates matter, for example before `SUM` or `COUNT`. Use `UNION ALL` there.
- Putting `ORDER BY` inside the first branch without parentheses. That is a syntax error.

## Performance

Deduplication needs a sort or hash over the whole result. If the branches cannot overlap, or duplicates are wanted, `UNION ALL` skips that step and is cheaper.

## Interview questions

### What is the difference between UNION and UNION ALL?

`UNION` removes duplicate rows from the combined result. `UNION ALL` keeps every row and is faster because it skips deduplication.

### How is UNION different from a JOIN?

A JOIN combines columns from related rows. `UNION` appends rows from queries with the same column layout.

### Which column names does the result use?

The names from the first `SELECT`. Aliases in later branches are ignored.

### Does UNION treat NULLs as duplicates?

Yes. For duplicate removal, two NULLs in the same column count as equal.

## Quick revision

- `UNION` stacks rows and removes duplicates.
- Same number of columns, compatible types, matched by position.
- Column names come from the first query.
- One `ORDER BY` at the end sorts the whole result.
- Add a literal label column to keep the source of each row.
- Prefer `UNION ALL` when duplicates are impossible or needed.
