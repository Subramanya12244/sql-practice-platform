---
title: UNION ALL
slug: union-all
category: set-operators
difficulty: Beginner
description: Append the rows of two queries and keep every duplicate with SQL UNION ALL, the fast choice for stacking data before you aggregate it.
prerequisites: [union]
related: [union, group-by, conditional-aggregation, cte]
questions: [86, 92, 93, 97]
patterns: [conditional-aggregation]
guides: [union-vs-union-all]
minutes: 7
version: 1
---

## Introduction

`UNION ALL` stacks the rows of two queries and keeps all of them. It is the version of UNION you use when every row counts.

## Definition

`query1 UNION ALL query2` returns all rows of `query1` followed by all rows of `query2`, duplicates included. The column rules are the same as for `UNION`.

## Why it matters

- Counting or summing across sources needs every row. `UNION` would silently drop repeated rows and change the totals.
- It is cheaper than `UNION` because there is no deduplication step.
- A common interview pattern: `UNION ALL` the sources with a label, then `GROUP BY` with conditional aggregation.

## How it works

1. Run each branch.
2. Append the rows, matching columns by position.
3. Apply the final `ORDER BY` / `LIMIT`, if any.

No sort, no hash, no duplicate check.

## Syntax

```sql-syntax
SELECT col1, col2 FROM table_a
UNION ALL
SELECT col1, col2 FROM table_b;
```

## Simple examples

Every customer and supplier country, with repeats. Compare the row counts with `UNION`:

```sql
SELECT
  (SELECT COUNT(*) FROM (SELECT country FROM customers UNION ALL SELECT country FROM suppliers) a) AS union_all_rows,
  (SELECT COUNT(*) FROM (SELECT country FROM customers UNION SELECT country FROM suppliers) u)     AS union_rows;
```

## Intermediate examples

Record count per entity, one row per table:

```sql
SELECT 'customers' AS entity, COUNT(*) AS records FROM customers
UNION ALL
SELECT 'suppliers', COUNT(*) FROM suppliers
UNION ALL
SELECT 'employees', COUNT(*) FROM employees
UNION ALL
SELECT 'products',  COUNT(*) FROM products;
```

## Advanced examples

Stack with a label, then pivot with conditional aggregation. Countries with more customers than employees and suppliers together:

```sql
WITH entities AS (
  SELECT country, 'customer' AS kind FROM customers
  UNION ALL
  SELECT country, 'supplier' FROM suppliers
  UNION ALL
  SELECT country, 'employee' FROM employees
)
SELECT country,
       COUNT(*) FILTER (WHERE kind = 'customer') AS customers,
       COUNT(*) FILTER (WHERE kind = 'supplier') AS suppliers,
       COUNT(*) FILTER (WHERE kind = 'employee') AS employees
FROM entities
GROUP BY country
HAVING COUNT(*) FILTER (WHERE kind = 'customer')
     > COUNT(*) FILTER (WHERE kind IN ('supplier', 'employee'))
ORDER BY customers DESC, country
LIMIT 5;
```

Why `UNION` would be wrong here: two customers in Germany produce two identical `('Germany', 'customer')` rows. `UNION` keeps one, and the count drops to 1.

## Real-world scenarios

- Event logs or fact tables split by month or region, combined for reporting.
- Per-source metrics stacked into one long table for a dashboard.
- Building an "entities" list before a `GROUP BY` pivot.

## PostgreSQL specifics

- PostgreSQL usually returns `UNION ALL` rows in branch order, but SQL does not guarantee it. Add `ORDER BY` when order matters.
- The planner shows `Append` for `UNION ALL`, and `HashAggregate` or `Unique` on top of it for `UNION`.
- Branches of a `UNION ALL` can run in parallel (`Parallel Append`) on large tables.

## Visual explanation

```text
customers.country   suppliers.country      UNION ALL
-----------------   -----------------    -------------
Germany             Germany              Germany
Germany             Japan        ==>     Germany
Mexico                                   Mexico
                                         Germany
                                         Japan
(every row kept: 3 + 2 = 5)
```

## Common mistakes

- Using `UNION` before an aggregate, which undercounts.
- Forgetting a label column, so you cannot tell which source a row came from.
- Mismatched column order. Columns match by position.
- Assuming the output order without `ORDER BY`.

## Performance

`UNION ALL` is a plain append, so it streams rows and needs no extra memory. Default to it, and use `UNION` only when you need distinct rows.

## Interview questions

### When must you use UNION ALL instead of UNION?

When duplicates are meaningful, such as before `COUNT` or `SUM`, or when the branches cannot overlap and you want to avoid the dedupe cost.

### Is UNION ALL faster than UNION? Why?

Yes. `UNION` must sort or hash all rows to remove duplicates. `UNION ALL` only appends.

### How do you know which branch a row came from?

Add a literal column in each branch, such as `'customer' AS kind`.

## Quick revision

- `UNION ALL` keeps every row, including duplicates.
- Row count = sum of branch row counts.
- Cheaper than `UNION`: no dedupe.
- Use it before aggregates.
- Add a label column, then `GROUP BY` with `FILTER` or `CASE`.
- Order is not guaranteed without `ORDER BY`.
