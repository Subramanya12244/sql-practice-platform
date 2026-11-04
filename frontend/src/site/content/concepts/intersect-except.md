---
slug: intersect-except
title: SQL INTERSECT and EXCEPT Explained with Examples
description: Learn SQL INTERSECT and EXCEPT with Northwind examples: find common or missing rows between queries, NULL behavior, ALL variants, and join alternatives.
keywords: sql intersect, sql except, intersect vs inner join, except vs not exists, set operators sql
questions: 92, 93, 96, 97, 85
related: union-vs-union-all, left-join, correlated-subquery
---

`INTERSECT` returns the rows that appear in the results of both queries. `EXCEPT` returns the rows from the first query that do not appear in the second (Oracle calls it `MINUS`). Like `UNION`, both compare entire rows, require matching column counts and compatible types, and remove duplicates unless you add `ALL`.

## Syntax

```sql
SELECT cols FROM query_a
INTERSECT [ALL]
SELECT cols FROM query_b;

SELECT cols FROM query_a
EXCEPT [ALL]
SELECT cols FROM query_b;
```

`INTERSECT` binds tighter than `UNION` and `EXCEPT`. Use parentheses when combining operators.

## Example

**Business question:** Which countries have both customers and suppliers, and which have customers but no suppliers?

```sql
-- Countries with both
SELECT country FROM customers
INTERSECT
SELECT country FROM suppliers
ORDER BY country;
```

```sql
-- Countries with customers but no suppliers
SELECT country FROM customers
EXCEPT
SELECT country FROM suppliers
ORDER BY country;
```

Illustrative result (first query):

| country |
|---|
| Brazil |
| Canada |
| France |
| Germany |

Illustrative result (second query):

| country |
|---|
| Argentina |
| Austria |
| Belgium |

## How it works

Both operators evaluate each query, then compare whole rows:

- **`INTERSECT`** keeps a distinct row if it exists in both inputs.
- **`EXCEPT`** keeps a distinct row from the first input if it does not exist in the second. Order matters: `A EXCEPT B` is not `B EXCEPT A`.
- **NULLs are treated as equal** in set comparisons. A NULL country in both inputs survives `INTERSECT`, unlike an `=` join, where `NULL = NULL` is not true.
- **`ALL` variants** respect multiplicity. If a value appears 3 times in A and once in B, `INTERSECT ALL` returns it once and `EXCEPT ALL` returns it twice.

Set operators also combine well with aggregates. Countries that have more customers than suppliers **and** more customers than employees:

```sql
WITH cust AS (SELECT country, COUNT(*) AS n FROM customers GROUP BY country),
supp AS (SELECT country, COUNT(*) AS n FROM suppliers GROUP BY country),
emp  AS (SELECT country, COUNT(*) AS n FROM employees GROUP BY country)
SELECT c.country FROM cust c
LEFT JOIN supp s ON s.country = c.country
WHERE c.n > COALESCE(s.n, 0)
INTERSECT
SELECT c.country FROM cust c
LEFT JOIN emp e ON e.country = c.country
WHERE c.n > COALESCE(e.n, 0)
ORDER BY country;
```

Each branch answers one condition; `INTERSECT` keeps countries passing both.

## Common mistakes

- **Comparing more columns than intended.** `SELECT country, city ... INTERSECT ...` requires both columns to match. Select only the key you are comparing.
- **Reversing `EXCEPT`.** "Customers' countries without suppliers" is `customers EXCEPT suppliers`. Swapping the order answers a different question.
- **Expecting duplicates.** Plain `INTERSECT` and `EXCEPT` deduplicate. Use `ALL` if counts matter.
- **Missing countries in comparisons.** Inner-joining count CTEs drops countries with no suppliers. Use `LEFT JOIN` plus `COALESCE(n, 0)` so "zero suppliers" still counts.
- **Inconsistent labels or casing.** As with `UNION`, `'Germany'` and `'germany'` are different rows. Clean or normalize values before comparing.
- **Assuming MySQL parity.** MySQL added `INTERSECT` and `EXCEPT` only in 8.0.31. PostgreSQL has long supported both.

## When to use it vs alternatives

| Goal | Set operator | Join / subquery alternative |
|---|---|---|
| Rows in both | `INTERSECT` | `INNER JOIN` + `DISTINCT`, or `EXISTS` |
| Rows in A not in B | `EXCEPT` | `NOT EXISTS`, or `LEFT JOIN ... IS NULL` |
| Need extra columns from A | Awkward | Join or `EXISTS` (keeps any A column) |
| NULL keys should match | Works | Needs `IS NOT DISTINCT FROM` |

Set operators are concise when comparing a single key list. When you need extra columns from one side, `EXISTS` / `NOT EXISTS` is usually clearer:

```sql
SELECT c.customer_id, c.company_name, c.country
FROM customers c
WHERE NOT EXISTS (SELECT 1 FROM suppliers s WHERE s.country = c.country);
```

## Interview questions

### What is the difference between INTERSECT and INNER JOIN?
`INTERSECT` compares entire rows from two queries and returns distinct rows present in both, treating NULLs as equal. `INNER JOIN` combines columns from two tables on a condition, can duplicate rows, and never matches NULL to NULL. Use `INTERSECT` for "which values are in both lists".

### What does EXCEPT do in SQL?
`EXCEPT` returns distinct rows from the first query that are absent from the second. It is the set difference A minus B, so the order of the queries matters. Oracle calls the same operator `MINUS`.

### How is EXCEPT different from NOT IN?
`EXCEPT` compares whole rows and treats NULLs as equal, so it behaves predictably. `NOT IN` returns no rows at all if the subquery contains a NULL. `NOT EXISTS` is the safe row-by-row alternative when you need additional columns.

### What do INTERSECT ALL and EXCEPT ALL do?
They keep duplicates according to multiplicity instead of deduplicating. `INTERSECT ALL` returns a row as many times as the smaller count in the two inputs; `EXCEPT ALL` returns it as many times as its count in A minus its count in B, if positive.

## Practice

Practice this pattern with the questions below.
