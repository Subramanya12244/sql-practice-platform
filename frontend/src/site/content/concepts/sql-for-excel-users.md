---
slug: sql-for-excel-users
title: SQL for Excel Users: VLOOKUP, SUMIF and Pivot Tables in SQL
description: Learn SQL as an Excel user: VLOOKUP becomes JOIN, SUMIF becomes GROUP BY, IF becomes CASE and pivot tables become conditional aggregation on Northwind.
keywords: sql for excel users, vlookup in sql, sumif in sql, excel pivot table sql, excel to sql, countif sql
questions: 1, 2, 11, 128, 129, 131, 101
related: inner-join, left-join, group-by-having, pivot-rows-to-columns, null-handling-coalesce
---

If you know Excel, you already know most of SQL's ideas; only the syntax changes. A table is a sheet with fixed column types, a query is a formula that returns a whole new sheet, and instead of dragging a formula down you describe the result once. This guide maps the Excel features analysts use every day to their SQL equivalents on the Northwind database.

## Syntax

| Excel | SQL |
|---|---|
| Filter a column | `WHERE` |
| Sort A to Z | `ORDER BY` |
| Remove duplicates | `SELECT DISTINCT` |
| `VLOOKUP` / `XLOOKUP` | `JOIN` |
| `SUMIF`, `COUNTIF`, `AVERAGEIF` | `GROUP BY` with `SUM`, `COUNT`, `AVG` |
| `IF`, nested `IF`, `IFS` | `CASE WHEN ... THEN ... END` |
| `IFERROR`, blank to 0 | `COALESCE` |
| Pivot table | `GROUP BY` plus `SUM(...) FILTER (WHERE ...)` |
| Running total `=SUM($B$2:B2)` | `SUM(...) OVER (ORDER BY ...)` |
| `&` or `CONCAT` | `CONCAT` (or the double-pipe operator) |

## Example

**VLOOKUP becomes JOIN.** Look up each product's supplier name:

```sql
SELECT p.product_name, p.unit_price, s.company_name AS supplier
FROM products p
LEFT JOIN suppliers s ON s.supplier_id = p.supplier_id
WHERE p.product_id IN (1, 2, 3)
ORDER BY p.product_id;
```

| product_name | unit_price | supplier |
|---|---|---|
| Chai | 18.00 | Exotic Liquids |
| Chang | 19.00 | New Orleans Cajun Delights |
| Aniseed Syrup | 10.00 | Grandma Kelly's Homestead |

A `LEFT JOIN` behaves like `VLOOKUP` with exact match: every product stays, and a missing supplier shows `NULL` instead of `#N/A`.

## How it works

**SUMIF and COUNTIF become GROUP BY.** Instead of one `COUNTIF` per country, one query counts all of them:

```sql
SELECT country, COUNT(*) AS customers
FROM customers
GROUP BY country
ORDER BY customers DESC, country
LIMIT 5;
```

| country | customers |
|---|---|
| USA | 13 |
| France | 11 |
| Germany | 11 |
| Brazil | 9 |
| UK | 7 |

**IF becomes CASE.** A nested `=IF(B2>=50,"Premium",IF(B2>=20,"Mid","Budget"))` translates to:

```sql
SELECT product_name,
       unit_price,
       CASE WHEN unit_price >= 50 THEN 'Premium'
            WHEN unit_price >= 20 THEN 'Mid'
            ELSE 'Budget'
       END AS band
FROM products
ORDER BY unit_price DESC
LIMIT 4;
```

| product_name | unit_price | band |
|---|---|---|
| Côte de Blaye | 263.50 | Premium |
| Thüringer Rostbratwurst | 123.79 | Premium |
| Mishi Kobe Niku | 97.00 | Premium |
| Sir Rodney's Marmalade | 81.00 | Premium |

**Pivot tables become conditional aggregation.** Rows field goes in `GROUP BY`, each column field value gets its own `FILTER`:

```sql
SELECT ship_country,
       COUNT(*) FILTER (WHERE ship_via = 1) AS shipper_1,
       COUNT(*) FILTER (WHERE ship_via = 2) AS shipper_2,
       COUNT(*) FILTER (WHERE ship_via = 3) AS shipper_3,
       COUNT(*) AS total
FROM orders
GROUP BY ship_country
ORDER BY total DESC
LIMIT 5;
```

| ship_country | shipper_1 | shipper_2 | shipper_3 | total |
|---|---|---|---|---|
| USA | 3 | 5 | 5 | 13 |
| France | 4 | 5 | 4 | 13 |
| Germany | 5 | 5 | 3 | 13 |
| Brazil | 5 | 1 | 3 | 9 |
| UK | 3 | 4 | 1 | 8 |

See [pivot rows to columns](/concepts/pivot-rows-to-columns) for the full pattern.

## Common mistakes

- **Thinking in cells.** SQL has no `B2`. Write the rule once for a column and it applies to every row.
- **Expecting rows to stay in order.** A table has no built-in order. Add `ORDER BY` whenever order matters.
- **Treating `NULL` like a blank or 0.** `NULL = NULL` is not true, and `NULL + 5` is `NULL`. Use `IS NULL` and `COALESCE`.
- **Duplicate lookups.** `VLOOKUP` returns the first match; a `JOIN` returns every match, which can multiply rows if the lookup key is not unique.
- **Filtering a total with `WHERE`.** Filtering on `SUM` or `COUNT` needs `HAVING`.

## When to use it vs alternatives

| Situation | Better choice |
|---|---|
| A few thousand rows, one-off analysis | Excel |
| Hundreds of thousands of rows or more | SQL |
| Data refreshed from a database regularly | SQL |
| Combining many tables reliably | SQL |
| Quick charts and formatting for a meeting | Excel, fed by a SQL query |

## Interview questions

### What is the SQL equivalent of VLOOKUP?
A `JOIN`. `LEFT JOIN lookup_table ON key = key` keeps every row from the main table and brings in matching columns, with `NULL` where there is no match.

### How do you do SUMIF in SQL?
Use `GROUP BY` for one total per category, for example `SELECT category, SUM(amount) FROM t GROUP BY category`. For a single condition in one column, use `SUM(amount) FILTER (WHERE condition)` or `SUM(CASE WHEN condition THEN amount END)`.

### How do you build a pivot table in SQL?
Put the pivot table's row field in `GROUP BY`, and write one conditional aggregate per column value with `FILTER` or `CASE WHEN`. The values field is what you `SUM` or `COUNT`.

### Why learn SQL if I already know Excel?
SQL works directly on databases with millions of rows, is repeatable and reviewable as text, and joins many tables without fragile lookup formulas. Most analyst roles expect both.

## Practice

Practice this pattern with the questions below.
