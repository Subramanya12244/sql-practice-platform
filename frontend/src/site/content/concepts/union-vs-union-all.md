---
slug: union-vs-union-all
title: SQL UNION vs UNION ALL Explained with Examples
description: SQL UNION vs UNION ALL explained with Northwind examples: deduplication, column count and type rules, type labels, ORDER BY placement, and performance.
keywords: sql union vs union all, sql union, union all, combine query results, union column rules
questions: 79, 80, 81, 82, 83, 84, 85, 86
related: intersect-except, full-outer-join, cte
---

`UNION` and `UNION ALL` stack the results of two or more `SELECT` statements into one result set. `UNION` removes duplicate rows from the combined output; `UNION ALL` keeps every row, including duplicates. Because `UNION ALL` skips the deduplication step it is faster, and it is the correct choice whenever duplicates are meaningful, such as when counting.

## Syntax

```sql
SELECT col1, col2 FROM table_a
UNION            -- or UNION ALL
SELECT col1, col2 FROM table_b
ORDER BY col1;   -- applies to the whole combined result
```

Rules:

- Every `SELECT` must return the **same number of columns**.
- Corresponding columns must have **compatible types**.
- Columns are matched **by position**, not by name.
- Output column names come from the **first** `SELECT`.

## Example

**Business question:** Build one contact directory of customers, suppliers, and employees, labelled by type.

```sql
SELECT contact_name AS name, city, country, 'Customer' AS contact_type
FROM customers
UNION ALL
SELECT contact_name, city, country, 'Supplier'
FROM suppliers
UNION ALL
SELECT first_name || ' ' || last_name, city, country, 'Employee'
FROM employees
ORDER BY contact_type, name;
```

Illustrative result:

| name | city | country | contact_type |
|---|---|---|---|
| Alejandra Camino | Madrid | Spain | Customer |
| Alexander Feuer | Leipzig | Germany | Customer |
| Ana Trujillo | México D.F. | Mexico | Customer |

`UNION ALL` is right here: the literal label already makes rows from different sources distinct, so deduplication would only cost time.

## How it works

`UNION` runs the queries, concatenates their rows, then removes duplicates across the **entire** combined set — including duplicates that existed inside a single branch. Two rows are duplicates only if every column matches; NULLs compare as equal for this purpose. `UNION ALL` just concatenates.

An `ORDER BY` placed at the end sorts the final result. To sort or limit one branch, wrap it in parentheses.

Counting across tables needs `UNION ALL`, because identical count rows from different branches must not merge:

```sql
WITH entity_rows AS (
    SELECT 'Customers' AS entity, customer_id::text AS id FROM customers
    UNION ALL
    SELECT 'Suppliers', supplier_id::text FROM suppliers
    UNION ALL
    SELECT 'Employees', employee_id::text FROM employees
    UNION ALL
    SELECT 'Shippers',  shipper_id::text FROM shippers
)
SELECT entity, COUNT(*) AS record_count
FROM entity_rows
GROUP BY entity
ORDER BY record_count DESC;
```

The `::text` casts make the ID columns type-compatible: `customer_id` is `VARCHAR`, the others are integers.

## Common mistakes

- **Inconsistent label case.** A recorded mistake on this site (Q82–Q84): one branch used `'employee'` while the others used `'Customer'` and `'Supplier'`. String comparison is case-sensitive, so a later `WHERE contact_type = 'Employee'` silently returns nothing. Keep labels identical in style.
- **`UNION` inside a counting CTE.** Recorded on Q86: `UNION` can collapse rows and break counts. Use `UNION ALL` when every row must survive.
- **Wrong alias in the first branch.** Column names come only from the first `SELECT`. A recorded slip was aliasing it `Name` when the spec required `Company_Name`.
- **Mismatched column order.** `SELECT city, country` in one branch and `SELECT country, city` in another runs without error but mixes the data.
- **Type mismatch.** Combining `customer_id` (`VARCHAR`) with `supplier_id` (`INTEGER`) fails. Cast explicitly.
- **Missing `ORDER BY`.** The order of a union is not guaranteed without it.

## When to use it vs alternatives

| Operator | Result | Duplicates |
|---|---|---|
| `UNION ALL` | All rows from all queries | Kept |
| `UNION` | All distinct rows | Removed |
| `INTERSECT` | Rows in both queries | Removed (`INTERSECT ALL` keeps) |
| `EXCEPT` | Rows in first, not second | Removed (`EXCEPT ALL` keeps) |
| `FULL OUTER JOIN` | Both sources side by side in columns | n/a |

Default to `UNION ALL`. Switch to `UNION` only when you specifically need distinct rows, such as a unique list of countries across customers and suppliers.

## Interview questions

### What is the difference between UNION and UNION ALL?
`UNION` combines results and removes duplicate rows across the whole output. `UNION ALL` combines results and keeps every row. `UNION ALL` is faster because it does not sort or hash to deduplicate.

### What are the rules for using UNION?
Each `SELECT` must have the same number of columns, with compatible data types in the same positions. Column names in the output come from the first query. A single `ORDER BY` at the end sorts the combined result.

### Does UNION remove duplicates within a single query too?
Yes. `UNION` deduplicates the entire combined result, so duplicate rows from the same branch are also collapsed. If you need a branch's duplicates preserved, use `UNION ALL`.

### How do you tell which table a row came from after a UNION?
Add a literal label column to each branch, such as `'Customer' AS contact_type`. Keep the labels consistent in spelling and case so downstream filters work.

## Practice

Practice this pattern with the questions below.
