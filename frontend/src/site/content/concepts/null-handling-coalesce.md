---
slug: null-handling-coalesce
title: SQL NULL Handling and COALESCE Explained
description: Learn SQL NULL handling with Northwind examples: COALESCE, IS NULL, NULLIF, the NOT IN trap, NULLs in joins and sorting, and || vs CONCAT in PostgreSQL.
keywords: sql null handling, sql coalesce, is null sql, not in null, nullif, concat vs ||
questions: 26, 27, 28, 31, 37, 39, 57, 61
related: count-star-vs-count-column, left-join, aggregate-functions
---

In SQL, `NULL` means "unknown or missing", not zero or an empty string. Any comparison with NULL, including `NULL = NULL`, yields unknown rather than true, so rows silently drop out of filters and joins. `COALESCE` returns the first non-NULL argument and is the standard way to replace missing values with a default.

## Syntax

```sql
COALESCE(expr1, expr2, ..., default)   -- first non-NULL value
NULLIF(a, b)                           -- NULL if a = b, else a
col IS NULL / col IS NOT NULL          -- the only correct NULL tests
a IS DISTINCT FROM b                   -- NULL-safe inequality
ORDER BY col DESC NULLS LAST           -- control NULL sort position
```

## Example

**Business question:** Show total revenue for every employee, showing 0 for anyone with no sales.

```sql
SELECT e.employee_id,
       e.first_name || ' ' || e.last_name AS employee,
       COALESCE(ROUND(SUM(od.unit_price * od.quantity * (1 - od.discount))::numeric, 2), 0) AS revenue
FROM employees e
LEFT JOIN orders o         ON o.employee_id = e.employee_id
LEFT JOIN order_details od ON od.order_id   = o.order_id
GROUP BY e.employee_id, e.first_name, e.last_name
ORDER BY revenue DESC;
```

Result (first two and last rows; Steven Buchanan has no orders):

| employee_id | employee | revenue |
|---|---|---|
| 6 | Michael Suyama | 32276.55 |
| 4 | Margaret Peacock | 22617.81 |
| 5 | Steven Buchanan | 0 |

Without `COALESCE`, the last row would show NULL, because `SUM` over no non-NULL values is NULL.

## How it works

**Three-valued logic.** Conditions evaluate to true, false, or unknown. `WHERE` keeps only true. So `WHERE region = 'WA'` and `WHERE region <> 'WA'` together still miss rows where `region` is NULL. Use `WHERE region IS DISTINCT FROM 'WA'` or add `OR region IS NULL`.

**Aggregates skip NULLs.** `AVG(x)` divides by the count of non-NULL values. If NULL should mean 0, use `AVG(COALESCE(x, 0))`, but only if that is the business meaning.

**Joins.** `NULL` never equals anything, so orders with a NULL `customer_id` match no customer in an inner join.

**Sorting.** PostgreSQL sorts NULLs as larger than any value: last in `ASC`, first in `DESC`. "Latest order per customer" sorted `DESC` puts never-ordered customers at the top unless you write `NULLS LAST`:

```sql
SELECT c.customer_id, MAX(o.order_date) AS last_order
FROM customers c
LEFT JOIN orders o ON o.customer_id = c.customer_id
GROUP BY c.customer_id
ORDER BY last_order DESC NULLS LAST;
```

**String concatenation.** In PostgreSQL, `||` returns NULL if any operand is NULL. `CONCAT()` treats NULL as an empty string. `CONCAT(NULL, ' ', NULL)` returns `' '` — a space, not NULL.

**Safe division.** `NULLIF` avoids division by zero: `SUM(x) / NULLIF(COUNT(*), 0)`.

## Common mistakes

- **`= NULL` instead of `IS NULL`.** `WHERE reports_to = NULL` returns no rows. Write `WHERE reports_to IS NULL`.
- **The `NOT IN` trap.** `WHERE customer_id NOT IN (SELECT customer_id FROM orders)` returns zero rows if any `orders.customer_id` is NULL, because `x <> NULL` is unknown. Use `NOT EXISTS` or filter `WHERE customer_id IS NOT NULL` inside the subquery.
- **`CONCAT` hiding a missing row.** A recorded mistake on this site (Q57): `CONCAT(e.first_name, ' ', e.last_name)` on an unmatched outer-join row produced `' '` when the expected output was NULL. Use `||` when NULL must propagate, `CONCAT` when you want a best-effort string.
- **`COALESCE` with mismatched types.** `COALESCE(o.shipped_date, 'Not shipped')` fails because a date and text cannot be combined. Cast: `COALESCE(o.shipped_date::text, 'Not shipped')`.
- **Replacing NULL too early.** `COALESCE(od.discount, 0)` inside an aggregate changes averages. Decide whether "missing" should count as zero.
- **Forgetting `COALESCE` after `SUM`.** Outer-join reports show NULL instead of 0 for entities with no activity.

## When to use it vs alternatives

| Need | Use |
|---|---|
| Default for missing value | `COALESCE(col, default)` |
| Convert a sentinel to NULL | `NULLIF(col, '')` |
| Test for missing | `IS NULL` / `IS NOT NULL` |
| Compare where NULLs should match | `IS NOT DISTINCT FROM` |
| Multi-branch logic | `CASE WHEN col IS NULL THEN ... END` |
| Anti join that is NULL-safe | `NOT EXISTS` |

`COALESCE` is standard SQL and accepts any number of arguments. Vendor functions like `IFNULL` (MySQL) or `NVL` (Oracle) take two and are not available in PostgreSQL.

## Interview questions

### What does COALESCE do in SQL?
`COALESCE` returns the first non-NULL argument from left to right, or NULL if all are NULL. It is commonly used to show 0 instead of NULL for aggregates over outer joins. All arguments must be type-compatible.

### Why does NOT IN return no rows when the subquery contains NULL?
`x NOT IN (a, b, NULL)` expands to `x <> a AND x <> b AND x <> NULL`. The last comparison is unknown, so the whole condition is never true. `NOT EXISTS` does not have this problem.

### What is the difference between || and CONCAT in PostgreSQL?
The `||` operator returns NULL if any operand is NULL. `CONCAT()` ignores NULL arguments and treats them as empty strings. Choose based on whether a missing name should produce NULL or a partial string.

### Is NULL equal to NULL in SQL?
No. `NULL = NULL` evaluates to unknown, so it is not true in `WHERE` or join conditions. Use `IS NULL`, or `IS NOT DISTINCT FROM` to compare two values where NULLs should be treated as equal. Set operators and `GROUP BY` do treat NULLs as equal.

## Practice

Practice this pattern with the questions below.
