---
title: SQL comparisons
slug: comparisons
description: Side-by-side SQL differences interviewers ask about, such as WHERE vs HAVING, UNION vs UNION ALL and IN vs EXISTS, with runnable examples.
---

## WHERE vs HAVING

| | WHERE | HAVING |
|---|---|---|
| Filters | individual rows | groups |
| Runs | before `GROUP BY` | after `GROUP BY` |
| Aggregates allowed | no | yes |
| Typical use | `country = 'USA'` | `COUNT(*) > 2` |

```sql
SELECT customer_id, COUNT(*) AS orders
FROM orders
WHERE freight > 10
GROUP BY customer_id
HAVING COUNT(*) >= 2
ORDER BY orders DESC;
```

Put row conditions in `WHERE`: it reduces the rows before grouping, which is cheaper.

## UNION vs UNION ALL

| | UNION | UNION ALL |
|---|---|---|
| Duplicates | removed | kept |
| Cost | extra sort or hash | none |
| Use when | you need distinct rows | sources are disjoint, or duplicates matter |

```sql
SELECT 'union' AS kind, COUNT(*) FROM (SELECT country FROM customers UNION SELECT country FROM suppliers) a
UNION ALL
SELECT 'union all', COUNT(*) FROM (SELECT country FROM customers UNION ALL SELECT country FROM suppliers) b;
```

## RANK vs DENSE_RANK vs ROW_NUMBER

| Values | ROW_NUMBER | RANK | DENSE_RANK |
|---|---|---|---|
| 100 | 1 | 1 | 1 |
| 100 | 2 | 1 | 1 |
| 90 | 3 | 3 | 2 |

- `ROW_NUMBER`: always unique, ties broken arbitrarily unless you add a tie-breaker.
- `RANK`: ties share a rank, then gaps.
- `DENSE_RANK`: ties share a rank, no gaps. Use it for "Nth highest value".

```sql
SELECT product_name, unit_price,
       ROW_NUMBER() OVER w AS row_number,
       RANK()       OVER w AS rank,
       DENSE_RANK() OVER w AS dense_rank
FROM products
WINDOW w AS (ORDER BY unit_price DESC)
LIMIT 10;
```

## JOIN vs EXISTS

| | JOIN | EXISTS |
|---|---|---|
| Returns columns from the other table | yes | no |
| Duplicates outer rows when several matches exist | yes | no |
| Stops at first match | no | yes |
| Best for | combining data | "has at least one" filters |

```sql
SELECT
  (SELECT COUNT(*) FROM customers c JOIN orders o ON o.customer_id = c.customer_id) AS join_rows,
  (SELECT COUNT(*) FROM customers c WHERE EXISTS (SELECT 1 FROM orders o WHERE o.customer_id = c.customer_id)) AS exists_rows;
```

The join returns one row per order. `EXISTS` returns one row per customer. Adding `DISTINCT` to a join to fix duplicates usually means you wanted `EXISTS`.

## IN vs EXISTS

| | IN (subquery) | EXISTS |
|---|---|---|
| Compares | a value against a list | whether a correlated row exists |
| NULLs in the list | `NOT IN` returns no rows | `NOT EXISTS` is NULL-safe |
| Multi-column match | `(a, b) IN (SELECT …)` | any condition |
| Performance in PostgreSQL | `IN` and `EXISTS` both become semi-joins | same |

```sql
SELECT
  (SELECT COUNT(*) FROM employees WHERE employee_id NOT IN (SELECT employee_id FROM orders)) AS not_in_rows,
  (SELECT COUNT(*) FROM employees e WHERE NOT EXISTS (SELECT 1 FROM orders o WHERE o.employee_id = e.employee_id)) AS not_exists_rows;
```

`orders.employee_id` contains one NULL, so `NOT IN` returns 0 rows whatever the data. `NOT EXISTS` gives the true answer.

## CTE vs subquery

| | CTE (`WITH`) | Subquery |
|---|---|---|
| Readability | named steps, top to bottom | nested, inside out |
| Reuse in one query | reference several times | repeat the text |
| Recursion | `WITH RECURSIVE` | not possible |
| Performance in PostgreSQL 12+ | inlined unless referenced twice or `MATERIALIZED` | inlined |

```sql
WITH customer_orders AS (
  SELECT customer_id, COUNT(*) AS n FROM orders GROUP BY customer_id
)
SELECT * FROM customer_orders
WHERE n = (SELECT MAX(n) FROM customer_orders);
```

Before PostgreSQL 12 every CTE was materialized, which could block optimizations.

## DELETE vs TRUNCATE vs DROP

| | DELETE | TRUNCATE | DROP |
|---|---|---|---|
| Removes | chosen rows (`WHERE`) | all rows | the table itself |
| Structure kept | yes | yes | no |
| Row triggers fire | yes | no | no |
| Speed on large tables | slow (row by row) | fast | fast |
| Rollback in PostgreSQL | yes | yes, inside a transaction | yes, inside a transaction |
| Resets identity | no | with `RESTART IDENTITY` | n/a |

```sql
CREATE TEMP TABLE scratch AS SELECT * FROM shippers;
DELETE FROM scratch WHERE shipper_id = 1;
TRUNCATE scratch;
INSERT INTO scratch SELECT * FROM shippers WHERE shipper_id = 2;
SELECT * FROM scratch;
```

In PostgreSQL DDL such as `TRUNCATE` and `DROP` is transactional. Many other databases commit DDL implicitly.

## COUNT(*) vs COUNT(column)

| | COUNT(*) | COUNT(col) | COUNT(DISTINCT col) |
|---|---|---|---|
| Counts | rows | non-NULL values | distinct non-NULL values |

```sql
SELECT COUNT(*) AS all_orders,
       COUNT(shipped_date) AS shipped,
       COUNT(employee_id) AS with_employee,
       COUNT(DISTINCT customer_id) AS customers
FROM orders;
```

After a `LEFT JOIN`, count a column from the right table so unmatched rows count as 0.

## NULL vs zero

| | NULL | 0 |
|---|---|---|
| Meaning | unknown or missing | a known value |
| `= NULL` / `= 0` | never true (use `IS NULL`) | normal comparison |
| In `SUM`/`AVG` | ignored | included |
| Arithmetic | `NULL + 1` is NULL | `0 + 1` is 1 |

```sql
SELECT AVG(x) AS avg_ignoring_null,
       AVG(COALESCE(x, 0)) AS avg_null_as_zero
FROM (VALUES (10), (NULL), (20)) AS t(x);
```

The first average is 15 and the second is 10. Choose deliberately whether a missing value means zero.

## ROWS vs RANGE frames

| | ROWS | RANGE |
|---|---|---|
| Frame measured in | physical rows | values of the `ORDER BY` key |
| Ties (peers) | split row by row | included together |
| `N PRECEDING` | N rows | key within N (number or interval, PostgreSQL 11+) |
| Default with `ORDER BY` | | `RANGE BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW` |

```sql
SELECT x,
       SUM(x) OVER (ORDER BY x ROWS  BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW) AS rows_sum,
       SUM(x) OVER (ORDER BY x RANGE BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW) AS range_sum
FROM (VALUES (1), (2), (2), (3)) AS t(x);
```

`rows_sum` is 1, 3, 5, 8. `range_sum` is 1, 5, 5, 8, because the two 2s are peers. Use `ROWS` for running totals unless you want ties grouped.
