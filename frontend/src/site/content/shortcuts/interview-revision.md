---
title: SQL interview quick revision
slug: interview-revision
description: One-page SQL interview revision covering execution order, joins, aggregation, NULLs, subqueries, window functions, classic patterns and PostgreSQL tips.
---

## Logical order of execution

`FROM` / `JOIN` → `WHERE` → `GROUP BY` → `HAVING` → `SELECT` → window functions → `DISTINCT` → `ORDER BY` → `LIMIT` / `OFFSET`

- `WHERE` cannot use aggregates or `SELECT` aliases.
- Window functions cannot appear in `WHERE`. Filter them in an outer query or CTE.
- In PostgreSQL `ORDER BY` can use `SELECT` aliases.

## Joins

- `INNER`: matches only. `LEFT`: all left rows plus matches. `FULL`: everything. `CROSS`: every combination.
- A filter on the right table of a `LEFT JOIN` belongs in `ON`. In `WHERE` it turns the join into an inner join.
- Joining a one-to-many table multiplies rows. Aggregate first, then join.
- Self join: one table, two aliases (employee `e`, manager `m`).

## Aggregation

- Every non-aggregated `SELECT` column must be in `GROUP BY`.
- `COUNT(*)` counts rows. `COUNT(col)` skips NULLs. `COUNT(DISTINCT col)` counts unique non-NULL values.
- Conditional totals: `SUM(CASE WHEN … THEN 1 ELSE 0 END)` or `COUNT(*) FILTER (WHERE …)` in PostgreSQL.

```sql
SELECT employee_id,
       COUNT(*) AS orders,
       COUNT(*) FILTER (WHERE shipped_date IS NULL) AS unshipped
FROM orders
GROUP BY employee_id
HAVING COUNT(*) > 5
ORDER BY orders DESC;
```

## NULLs

- `= NULL` is never true. Use `IS NULL` or `IS DISTINCT FROM`.
- `NOT IN` with a NULL in the subquery returns nothing. Use `NOT EXISTS`.
- `COALESCE(x, 0)` for defaults, `NULLIF(x, 0)` to avoid division by zero.
- PostgreSQL sorts NULLs last in `ASC` and first in `DESC`. Override with `NULLS FIRST` / `NULLS LAST`.

## Subqueries and CTEs

- Scalar subquery: one value (`> (SELECT AVG(…))`).
- Correlated subquery: refers to the outer row.
- `EXISTS` / `NOT EXISTS`: semi-join and anti-join. They never duplicate rows.
- CTEs make steps readable. `WITH RECURSIVE` walks hierarchies.

## Window functions

- `fn() OVER (PARTITION BY g ORDER BY k frame)` keeps every row.
- `ROW_NUMBER` is unique, `RANK` has gaps after ties, `DENSE_RANK` has no gaps.
- `LAG` / `LEAD` read neighbouring rows. `FIRST_VALUE` / `LAST_VALUE` need the right frame.
- The default frame with `ORDER BY` is `RANGE … CURRENT ROW`, which includes ties. Use `ROWS` for exact running totals.

```sql
SELECT category_id, product_name, unit_price,
       DENSE_RANK() OVER (PARTITION BY category_id ORDER BY unit_price DESC) AS price_rank,
       unit_price - LAG(unit_price) OVER (PARTITION BY category_id ORDER BY unit_price DESC) AS diff_from_prev
FROM products
ORDER BY category_id, price_rank
LIMIT 10;
```

## Classic patterns

| Question | Tool |
|---|---|
| Duplicates | `GROUP BY … HAVING COUNT(*) > 1` |
| Second / Nth highest | `DENSE_RANK() = N`, or `MAX(x) WHERE x < MAX(x)` |
| Top N per group | `ROW_NUMBER() OVER (PARTITION BY …) <= N` |
| Latest row per group | `ROW_NUMBER … = 1` or `DISTINCT ON` (PostgreSQL) |
| Never / without | `NOT EXISTS` or `LEFT JOIN … IS NULL` |
| Running total | `SUM(x) OVER (ORDER BY k ROWS UNBOUNDED PRECEDING)` |
| Month-over-month | `LAG(x) OVER (ORDER BY month)` with `NULLIF` |
| Streaks / islands | `date - ROW_NUMBER()` or `LAG` flags plus a running `SUM` |
| Pivot | `SUM(x) FILTER (WHERE col = 'v')` per column |
| Hierarchy | `WITH RECURSIVE` |

```sql
SELECT customer_id
FROM customers c
WHERE NOT EXISTS (SELECT 1 FROM orders o WHERE o.customer_id = c.customer_id);
```

## Data changes and design

- `DELETE` removes rows, `TRUNCATE` empties the table, `DROP` removes it. All three can be rolled back in PostgreSQL.
- Use `RETURNING` to see changed rows, and `INSERT … ON CONFLICT` to upsert.
- Primary key: unique and NOT NULL. Foreign key: references a parent key. PostgreSQL does not index foreign-key columns automatically.
- Normalise to remove redundancy. Denormalise deliberately for read speed.

## Performance checklist

- Read the plan with `EXPLAIN (ANALYZE, BUFFERS)`.
- Index columns used in selective `WHERE`, `JOIN` and `ORDER BY`. Put the most selective equality column first in a composite index.
- Keep predicates sargable: `d >= x AND d < y`, not `EXTRACT(YEAR FROM d) = …`.
- Prefer `UNION ALL` to `UNION` when duplicates are impossible.
- Use `EXISTS` instead of `COUNT(*) > 0`, and keyset pagination instead of large `OFFSET`s.

## Interview habits

- Restate the grain: "one row per customer per month".
- Ask about ties, NULLs and empty groups before you write the query.
- Build in CTE steps and check row counts at each step.
- Say which behaviour is PostgreSQL-specific.
