---
slug: second-highest-value
title: SQL Second Highest Salary or Price: 4 Ways to Solve It
description: Find the second highest salary or price in SQL with MAX subquery, OFFSET, DENSE_RANK and per-group variants, plus the NULL edge case interviewers check.
keywords: second highest salary sql, second highest value sql, second max sql, nth highest salary, dense_rank second highest, offset 1 limit 1
questions: 14, 99, 100, 122
related: nth-highest-value, rank-vs-dense-rank-vs-row-number, top-n-per-group, window-functions
---

"Find the second highest salary" is one of the most asked SQL interview questions. Northwind has no salary column, so this guide uses `products.unit_price`; the logic is identical. The trap is ties: if two products share the top price, the "second highest" should usually be the next distinct value, not a duplicate of the first.

## Syntax

```sql
-- 1. MAX below the MAX
SELECT MAX(col) FROM t WHERE col < (SELECT MAX(col) FROM t);

-- 2. Distinct values, skip one
SELECT DISTINCT col FROM t ORDER BY col DESC OFFSET 1 LIMIT 1;

-- 3. DENSE_RANK
SELECT col FROM (
    SELECT col, DENSE_RANK() OVER (ORDER BY col DESC) AS dr FROM t
) x
WHERE dr = 2;
```

## Example

**Business question:** What is the second highest product price?

```sql
SELECT MAX(unit_price) AS second_highest_price
FROM products
WHERE unit_price < (SELECT MAX(unit_price) FROM products);
```

| second_highest_price |
|---|
| 123.79 |

The `OFFSET` version returns the same value:

```sql
SELECT DISTINCT unit_price
FROM products
ORDER BY unit_price DESC
OFFSET 1 LIMIT 1;
```

| unit_price |
|---|
| 123.79 |

## How it works

1. The inner `MAX` finds the top price (263.50). The outer `MAX` takes the largest price strictly below it.
2. In the `OFFSET` version, `DISTINCT` collapses ties first, so `OFFSET 1` skips one value, not one row.
3. `DENSE_RANK` gives tied values the same rank with no gaps, so rank 2 is always the second distinct value. It generalises to any N and to per-group questions.

**Second highest per group** uses `DENSE_RANK` with `PARTITION BY`:

```sql
WITH r AS (
    SELECT c.category_name,
           p.product_name,
           p.unit_price,
           DENSE_RANK() OVER (PARTITION BY c.category_name ORDER BY p.unit_price DESC) AS dr
    FROM products p
    JOIN categories c ON c.category_id = p.category_id
)
SELECT category_name, product_name, unit_price
FROM r
WHERE dr = 2
ORDER BY category_name;
```

| category_name | product_name | unit_price |
|---|---|---|
| Beverages | Ipoh Coffee | 46.00 |
| Condiments | Northwoods Cranberry Sauce | 40.00 |
| Confections | Tarte au sucre | 49.30 |
| Dairy Products | Queso Manchego La Pastora | 38.00 |
| Grains/Cereals | Wimmers gute Semmelknödel | 33.25 |
| Meat/Poultry | Mishi Kobe Niku | 97.00 |
| Produce | Rössle Sauerkraut | 45.60 |
| Seafood | Ikura | 31.00 |

**Returning NULL when there is no second value.** The classic LeetCode version requires `NULL`, not an empty result. Wrap the `OFFSET` query in a scalar subquery:

```sql
SELECT (
    SELECT DISTINCT unit_price
    FROM products
    WHERE category_id = 999
    ORDER BY unit_price DESC
    OFFSET 1 LIMIT 1
) AS second_highest;
```

| second_highest |
|---|
| |

The `MAX` version already returns `NULL` in that case, because `MAX` over zero rows is `NULL`.

## Common mistakes

- **`ORDER BY ... OFFSET 1 LIMIT 1` without `DISTINCT`.** If two rows tie for first, you return the top value again.
- **Using `ROW_NUMBER` for rank 2.** Same tie problem. Use `DENSE_RANK`.
- **Returning zero rows instead of `NULL`.** Many graders expect a single `NULL` row. Use a scalar subquery or `MAX`.
- **Filtering the window column in `WHERE`.** Compute `DENSE_RANK` in a subquery or CTE first.

## When to use it vs alternatives

| Approach | Ties | Generalises to N | Per group |
|---|---|---|---|
| `MAX` below `MAX` | Distinct | Awkward | With correlated subquery |
| `DISTINCT ... OFFSET 1 LIMIT 1` | Distinct | Yes (`OFFSET N-1`) | With `LATERAL` |
| `DENSE_RANK() = 2` | Distinct | Yes | Yes, with `PARTITION BY` |

For the general case see [Nth highest value](/concepts/nth-highest-value).

## Interview questions

### How do you find the second highest salary in SQL?
Take the `MAX` of salaries strictly below the overall `MAX`, or select distinct salaries ordered descending with `OFFSET 1 LIMIT 1`. Both treat tied top salaries as one value.

### What if there is no second highest value?
The `MAX` approach returns `NULL` automatically. The `OFFSET` approach returns no rows, so wrap it in a scalar subquery `SELECT (...) AS second_highest` to get a `NULL` row.

### Why use DENSE_RANK instead of RANK or ROW_NUMBER?
`DENSE_RANK` gives ties the same rank and leaves no gap, so rank 2 is always the second distinct value. `RANK` can skip 2 entirely after a tie, and `ROW_NUMBER` splits ties arbitrarily.

### How do you get the second highest value per department or category?
Use `DENSE_RANK() OVER (PARTITION BY group ORDER BY value DESC)` in a CTE and keep rows where the rank equals 2.

## Practice

Practice this pattern with the questions below.
