---
slug: rank-vs-dense-rank-vs-row-number
title: RANK vs DENSE_RANK vs ROW_NUMBER in SQL
description: RANK vs DENSE_RANK vs ROW_NUMBER explained with a real Northwind price ranking: how each handles ties, gaps, and which to pick for top-N interview questions.
keywords: rank vs dense_rank, rank vs dense_rank vs row_number, row_number vs rank, sql ranking functions, dense_rank example, rank ties sql
questions: 99, 100, 14, 24, 50, 106
related: window-functions, top-n-per-group, nth-highest-value
---

`ROW_NUMBER`, `RANK` and `DENSE_RANK` are window functions that number rows in a chosen order. They only differ when two rows tie. `ROW_NUMBER` always gives unique numbers, `RANK` gives ties the same number and then skips, and `DENSE_RANK` gives ties the same number without skipping.

## Syntax

```sql
SELECT col,
       ROW_NUMBER() OVER (PARTITION BY grp ORDER BY metric DESC) AS row_num,
       RANK()       OVER (PARTITION BY grp ORDER BY metric DESC) AS rnk,
       DENSE_RANK() OVER (PARTITION BY grp ORDER BY metric DESC) AS dense_rnk
FROM some_table;
```

`PARTITION BY` is optional; `ORDER BY` inside `OVER` is required for meaningful ranks.

## Example

**Business question:** Rank products by unit price, most expensive first, and compare the three functions.

```sql
SELECT product_name,
       unit_price,
       ROW_NUMBER() OVER (ORDER BY unit_price DESC) AS row_num,
       RANK()       OVER (ORDER BY unit_price DESC) AS rnk,
       DENSE_RANK() OVER (ORDER BY unit_price DESC) AS dense_rnk
FROM products
ORDER BY unit_price DESC, product_name
LIMIT 12 OFFSET 8;
```

Illustrative result (rows 9–16):

| product_name | unit_price | row_num | rnk | dense_rnk |
|---|---|---|---|---|
| Ipoh Coffee | 46.00 | 9 | 9 | 9 |
| Rössle Sauerkraut | 45.60 | 10 | 10 | 10 |
| Schoggi Schokolade | 43.90 | 11 | 11 | 11 |
| Vegie-spread | 43.90 | 12 | 11 | 11 |
| Northwoods Cranberry Sauce | 40.00 | 13 | 13 | 12 |
| Alice Mutton | 39.00 | 14 | 14 | 13 |
| Gnocchi di nonna Alice | 38.00 | 15 | 15 | 14 |
| Queso Manchego La Pastora | 38.00 | 16 | 15 | 14 |

Look at the 43.90 tie: both products get `rnk` 11, so the next product jumps to 13. `dense_rnk` continues at 12. `row_num` ignores the tie entirely (11 and 12).

## How it works

| Function | Tied rows | After a tie | Max value |
|---|---|---|---|
| `ROW_NUMBER()` | Different numbers (arbitrary order) | +1 | Row count |
| `RANK()` | Same number | Skips by tie size | Row count |
| `DENSE_RANK()` | Same number | +1 | Number of distinct values |

- `RANK` answers "how many rows are strictly ahead of me, plus one". It is the sports-league ranking (1, 2, 2, 4).
- `DENSE_RANK` answers "which distinct value level am I on". It is what you need for "second highest price" (see [Nth highest value](/concepts/nth-highest-value)).
- `ROW_NUMBER` is a position, useful for "exactly one row per group" and pagination.

Since the order of tied rows under `ROW_NUMBER` is not guaranteed, add a tiebreaker for stable results:

```sql
SELECT product_name, unit_price,
       ROW_NUMBER() OVER (ORDER BY unit_price DESC, product_id) AS row_num
FROM products;
```

**Ranking within groups.** Add `PARTITION BY` and each function restarts at 1 for every group. This query ranks products by price inside each category, and the outer filter keeps the top two price levels per category:

```sql
SELECT category_id, product_name, unit_price, dense_rnk
FROM (
    SELECT category_id, product_name, unit_price,
           DENSE_RANK() OVER (PARTITION BY category_id ORDER BY unit_price DESC) AS dense_rnk
    FROM products
) t
WHERE dense_rnk <= 2
ORDER BY category_id, dense_rnk, product_name;
```

## Common mistakes

- **Using `ROW_NUMBER` for "top 3 prices".** If two products tie at third place, one silently disappears. Use `DENSE_RANK` or `RANK`.
- **Using `RANK` for "Nth distinct value".** After a tie, rank 2 may not exist (1, 1, 3). `DENSE_RANK` guarantees consecutive levels.
- **Assuming `ROW_NUMBER` is deterministic.** Without a unique tiebreaker, reruns can swap tied rows.
- **Wrong sort direction.** `ORDER BY metric` ranks the smallest first. Highest-first needs `DESC`.
- **NULL placement.** In PostgreSQL, NULLs sort first in `DESC` order and would take rank 1. Add `NULLS LAST` or filter them.

## When to use it vs alternatives

- **Exactly N rows per group:** `ROW_NUMBER`.
- **Top N including everyone tied at the cut-off:** `RANK` (returns possibly more than N rows).
- **Nth distinct value / top N distinct levels:** `DENSE_RANK`.
- **Buckets such as quartiles:** `NTILE(4)`, as in [Customer Revenue Quartiles](/questions/q106-customer-revenue-quartiles).
- **Relative position 0–1:** `PERCENT_RANK()`, as in [Employee Revenue Percentile Rank](/questions/q108-employee-revenue-percentile-rank).

For filtering by rank per group, see [Top N per group](/concepts/top-n-per-group).

## Interview questions

### What is the difference between RANK and DENSE_RANK?
Both give tied rows the same rank. `RANK` then skips numbers equal to the number of tied rows (1, 2, 2, 4), while `DENSE_RANK` continues with the next integer (1, 2, 2, 3).

### When would you use ROW_NUMBER instead of RANK?
When you need exactly one row per position, such as deduplicating rows, picking the latest order per customer, or paginating. `ROW_NUMBER` never produces duplicates, but it breaks ties arbitrarily unless you add a tiebreaker.

### Which ranking function finds the second highest value?
`DENSE_RANK`, filtered to 2. It counts distinct values, so a tie at the top does not cause rank 2 to be skipped as it can with `RANK`.

### Can these functions be used without ORDER BY?
PostgreSQL allows `ROW_NUMBER() OVER ()`, but the numbering is arbitrary. `RANK` and `DENSE_RANK` without `ORDER BY` give every row rank 1. Always specify an order.

## Practice

Practice this pattern with the questions below.
