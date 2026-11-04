---
title: Introduction to SQL
slug: intro-to-sql
category: fundamentals
difficulty: Beginner
description: What SQL is, how a relational database stores data in tables, and the logical order PostgreSQL uses to evaluate a SELECT query.
prerequisites: []
related: [select, where, order-by, inner-join, group-by]
questions: [1, 3, 5, 110]
patterns: []
guides: [sql-order-of-execution]
minutes: 7
version: 1
---

## Introduction

SQL (Structured Query Language) is the language for asking questions of relational databases. You describe *what* rows you want; the database decides *how* to fetch them. This site uses PostgreSQL 16 and the Northwind sample database: customers, orders, order lines, products, categories, suppliers, employees and shippers.

## Definition

A relational database stores data in **tables**. Each table has named, typed **columns** and holds **rows**. Tables link through **keys**: `orders.customer_id` references `customers.customer_id`. SQL is declarative: a query states the result, not the algorithm.

SQL is usually split into sub-languages:

- **DQL**: `SELECT` (read data)
- **DML**: `INSERT`, `UPDATE`, `DELETE` (change data)
- **DDL**: `CREATE`, `ALTER`, `DROP` (change structure)
- **TCL**: `BEGIN`, `COMMIT`, `ROLLBACK` (transactions)

## Why it matters

Almost every data role uses SQL daily, and interviews test it directly. Knowing the logical evaluation order explains most "why doesn't this work?" errors, such as using a `SELECT` alias inside `WHERE`.

## How it works

A `SELECT` is written in one order but evaluated logically in another:

1. `FROM` / `JOIN`: build the working set of rows
2. `WHERE`: filter rows
3. `GROUP BY`: form groups
4. `HAVING`: filter groups
5. `SELECT`: compute output columns and aliases
6. `DISTINCT`: remove duplicate rows
7. `ORDER BY`: sort
8. `LIMIT` / `OFFSET`: cut the result

The planner may physically execute steps differently, but the result must match this logical order.

## Syntax

```sql-syntax
SELECT   column_list
FROM     table_name
JOIN     other_table ON join_condition
WHERE    row_condition
GROUP BY grouping_columns
HAVING   group_condition
ORDER BY sort_columns
LIMIT    n OFFSET m;
```

## Simple examples

Read a few rows from one table:

```sql
SELECT product_id, product_name, unit_price
FROM products
LIMIT 5;
```

Count rows in a table:

```sql
SELECT COUNT(*) AS order_count FROM orders;
```

## Intermediate examples

Filter, then sort:

```sql
SELECT company_name, country
FROM customers
WHERE country = 'Germany'
ORDER BY company_name;
```

## Advanced examples

A query that uses most clauses. Read it in evaluation order: join, filter, group, filter groups, select, sort, limit.

```sql
SELECT c.category_name,
       COUNT(*) AS products,
       ROUND(AVG(p.unit_price), 2) AS avg_price
FROM products p
JOIN categories c ON c.category_id = p.category_id
WHERE NOT p.discontinued
GROUP BY c.category_name
HAVING COUNT(*) >= 5
ORDER BY avg_price DESC
LIMIT 3;
```

## Real-world scenarios

- Sales dashboards: revenue by month, region or product.
- Operations: find late or unshipped orders.
- Data quality: find duplicates, missing references or NULLs.
- Application back ends: every page load usually runs several SQL queries.

## PostgreSQL specifics

- Unquoted identifiers are folded to lower case: `SELECT Product_Name` reads `product_name`.
- String literals use single quotes; double quotes are for identifiers.
- PostgreSQL supports `LIMIT`/`OFFSET`, `ILIKE`, `RETURNING`, `::` casts and `FILTER` on aggregates. These are not all standard SQL.

## Visual explanation

```text
customers (1) ──< orders (many) ──< order_details >── products >── categories
                    │                                    │
                employees                            suppliers
                shippers (ship_via)
```

## Common mistakes

- Using a `SELECT` alias in `WHERE`: `WHERE` runs before `SELECT`.
- Assuming rows come back in a fixed order without `ORDER BY`.
- Using double quotes for strings: `"Germany"` is a column name in PostgreSQL.
- Comparing with `= NULL` instead of `IS NULL`.

## Performance

Filter early with `WHERE`, select only the columns you need, and index columns used in joins and filters. `EXPLAIN` shows the plan PostgreSQL chose.

## Interview questions

### What is the logical order of evaluation of a SELECT query?

`FROM`/`JOIN`, `WHERE`, `GROUP BY`, `HAVING`, `SELECT`, `DISTINCT`, `ORDER BY`, `LIMIT`/`OFFSET`.

### Why can you use a SELECT alias in ORDER BY but not in WHERE?

`ORDER BY` is evaluated after `SELECT`, so the alias exists. `WHERE` is evaluated before `SELECT`.

### What is the difference between DDL and DML?

DDL changes structure (`CREATE`, `ALTER`, `DROP`). DML changes data (`INSERT`, `UPDATE`, `DELETE`).

### What does "declarative" mean for SQL?

You state the result you want; the query planner picks the algorithm (index scan, hash join and so on).

## Quick revision

- Tables hold rows; columns have types; keys link tables.
- Evaluation order: FROM, WHERE, GROUP BY, HAVING, SELECT, DISTINCT, ORDER BY, LIMIT.
- No `ORDER BY` means no guaranteed order.
- Strings use single quotes; identifiers fold to lower case in PostgreSQL.
- `NULL` needs `IS NULL`, never `= NULL`.
