---
slug: nth-highest-value
title: Find the Second (Nth) Highest Value in SQL
description: Find the second or Nth highest value in SQL with DENSE_RANK, LIMIT OFFSET and a MAX subquery, using Northwind product prices as the classic salary question.
keywords: second highest salary sql, nth highest salary sql, find second highest value sql, nth highest value, dense_rank second highest, limit offset nth row
questions: 99, 50, 14, 100
related: rank-vs-dense-rank-vs-row-number, top-n-per-group, window-functions, correlated-subquery
---

"Find the second highest salary" is one of the most common SQL interview questions. The task is to return the Nth largest *distinct* value of a column, and to handle ties and missing values correctly. Here we use `products.unit_price` as the salary stand-in and solve it three ways: `DENSE_RANK`, `LIMIT/OFFSET`, and a `MAX` subquery.

## Syntax

```sql
-- 1. DENSE_RANK (any N, returns all tied rows)
SELECT *
FROM (
    SELECT t.*, DENSE_RANK() OVER (ORDER BY value_col DESC) AS dr
    FROM some_table t
) ranked
WHERE dr = N;

-- 2. DISTINCT + OFFSET (any N, returns the value)
SELECT DISTINCT value_col
FROM some_table
ORDER BY value_col DESC
OFFSET N - 1 LIMIT 1;

-- 3. MAX below MAX (N = 2 only)
SELECT MAX(value_col)
FROM some_table
WHERE value_col < (SELECT MAX(value_col) FROM some_table);
```

## Example

**Business question:** Which product has the second highest unit price?

First, the top distinct prices for reference:

```sql
SELECT DISTINCT unit_price
FROM products
ORDER BY unit_price DESC
LIMIT 5;
```

| unit_price |
|---|
| 263.50 |
| 123.79 |
| 97.00 |
| 81.00 |
| 62.50 |

**Method 1: DENSE_RANK**

```sql
SELECT product_name, unit_price
FROM (
    SELECT product_name, unit_price,
           DENSE_RANK() OVER (ORDER BY unit_price DESC) AS dr
    FROM products
) t
WHERE dr = 2;
```

| product_name | unit_price |
|---|---|
| Thüringer Rostbratwurst | 123.79 |

**Method 2: DISTINCT with OFFSET**

```sql
SELECT DISTINCT unit_price
FROM products
ORDER BY unit_price DESC
OFFSET 1 LIMIT 1;
```

Returns `123.79`.

**Method 3: MAX subquery**

```sql
SELECT MAX(unit_price) AS second_highest
FROM products
WHERE unit_price < (SELECT MAX(unit_price) FROM products);
```

Returns `second_highest = 123.79`.

## How it works

- **DENSE_RANK** gives every distinct price a consecutive level (1, 2, 3...). Filtering `dr = 2` returns every product at the second price level, so ties are all included. Change `2` to any N.
- **OFFSET** skips N − 1 rows of the sorted distinct list and takes one. `DISTINCT` is what makes it "second highest value" rather than "second row".
- **MAX below MAX** finds the largest price strictly less than the top price. It is portable and easy to explain, but generalising it to N means nesting subqueries.

To find the Nth highest **per group** (for example second most expensive product per category), add `PARTITION BY category_id` to the `DENSE_RANK` window. See [top N per group](/concepts/top-n-per-group).

## Common mistakes

- **Using `ROW_NUMBER` or `RANK`.** If two products tie for the top price, `ROW_NUMBER = 2` returns the tied duplicate, and `RANK = 2` returns nothing (ranks go 1, 1, 3). `DENSE_RANK` is the safe choice; see [RANK vs DENSE_RANK vs ROW_NUMBER](/concepts/rank-vs-dense-rank-vs-row-number).
- **Forgetting `DISTINCT` with `OFFSET`.** Without it, a tie at the top makes `OFFSET 1` return the highest value again.
- **`ORDER BY ... DESC` with NULLs.** PostgreSQL sorts NULLs first in descending order, so a NULL can become "the highest". Add `NULLS LAST` or `WHERE value_col IS NOT NULL`.
- **Empty result vs NULL.** If there is no second value, the `OFFSET` and `DENSE_RANK` methods return zero rows, while the `MAX` method returns one row with NULL. Some interview prompts (the LeetCode version) require NULL; wrap with `SELECT (subquery) AS second_highest` to get it.
- **Hard-coding N into nested `MAX` subqueries.** It does not scale beyond 2 or 3.

## When to use it vs alternatives

| Method | Any N | Ties | Returns rows | Notes |
|---|---|---|---|---|
| `DENSE_RANK` | Yes | All tied rows | Full rows | Best general answer; works per group |
| `DISTINCT ... OFFSET` | Yes | Value only | One value | Short; not per group |
| `MAX < MAX` | Only 2 | Value only | One value | Portable, no window functions |
| Correlated `COUNT(DISTINCT)` | Yes | All tied rows | Full rows | `WHERE N-1 = (SELECT COUNT(DISTINCT ...) WHERE x > outer.x)`; slow |

## Interview questions

### How do you find the second highest salary in SQL?
Use `DENSE_RANK() OVER (ORDER BY salary DESC)` in a subquery and filter to 2, or `SELECT MAX(salary) WHERE salary < (SELECT MAX(salary) ...)`. Both handle duplicate top salaries correctly.

### How do you find the Nth highest value?
`DENSE_RANK` filtered to N, or `SELECT DISTINCT value ORDER BY value DESC OFFSET N-1 LIMIT 1`. `DENSE_RANK` also returns the full rows and works per group with `PARTITION BY`.

### Why DENSE_RANK and not RANK?
`RANK` skips numbers after ties. If two rows share the highest value, the next value gets rank 3 and `rank = 2` finds nothing. `DENSE_RANK` never skips, so rank 2 is always the second distinct value.

### What should the query return if there is no second highest value?
It depends on the spec. Many prompts expect NULL; the scalar `MAX` subquery returns NULL naturally. The window and `OFFSET` versions return no rows unless you wrap them as a scalar subquery.

## Practice

Practice this pattern with the questions below.
