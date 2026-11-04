---
slug: find-duplicates
title: How to Find Duplicate Rows in SQL
description: Learn how to find duplicate rows in SQL with GROUP BY HAVING COUNT(*) > 1 and window COUNT(*) OVER, using Northwind customers that share a city and postal code.
keywords: find duplicates sql, sql find duplicate rows, having count > 1, duplicate records sql, count over partition by duplicates, delete duplicates sql
questions: 63, 64, 66, 67, 68, 70
related: group-by-having, self-join, window-functions, count-star-vs-count-column
---

Finding duplicates means identifying rows that share the same values in the columns that should be unique, such as two customers with the same city and postal code. The two standard tools are `GROUP BY ... HAVING COUNT(*) > 1`, which lists the duplicated values, and `COUNT(*) OVER (PARTITION BY ...)`, which returns every duplicated row with full detail.

## Syntax

```sql
-- Which values are duplicated, and how often
SELECT col_a, col_b, COUNT(*) AS n
FROM some_table
GROUP BY col_a, col_b
HAVING COUNT(*) > 1;

-- Every row that belongs to a duplicate group
SELECT *
FROM (
    SELECT t.*, COUNT(*) OVER (PARTITION BY col_a, col_b) AS n
    FROM some_table t
) x
WHERE n > 1;
```

## Example

**Business question:** Which city and postal code combinations are shared by more than one customer?

```sql
SELECT city, postal_code, COUNT(*) AS customers
FROM customers
GROUP BY city, postal_code
HAVING COUNT(*) > 1
ORDER BY customers DESC, city;
```

Result:

| city | postal_code | customers |
|---|---|---|
| Buenos Aires | 1010 | 3 |
| México D.F. | 05033 | 2 |
| Nantes | 44000 | 2 |

That tells you *which* values repeat. To see *which customers* they are, use a window count:

```sql
SELECT *
FROM (
    SELECT customer_id, company_name, city, postal_code,
           COUNT(*) OVER (PARTITION BY city, postal_code) AS dup_count
    FROM customers
) t
WHERE dup_count > 1
ORDER BY city, customer_id;
```

| customer_id | company_name | city | postal_code | dup_count |
|---|---|---|---|---|
| CACTU | Cactus Comidas para llevar | Buenos Aires | 1010 | 3 |
| OCEAN | Océano Atlántico Ltda. | Buenos Aires | 1010 | 3 |
| RANCH | Rancho grande | Buenos Aires | 1010 | 3 |
| PERIC | Pericles Comidas clásicas | México D.F. | 05033 | 2 |
| TORTU | Tortuga Restaurante | México D.F. | 05033 | 2 |
| DUMON | Du monde entier | Nantes | 44000 | 2 |
| FRANR | France restauration | Nantes | 44000 | 2 |

The same pattern on a single column, suppliers per country:

```sql
SELECT country, COUNT(*) AS suppliers
FROM suppliers
GROUP BY country
HAVING COUNT(*) > 1
ORDER BY suppliers DESC, country;
```

The top rows are USA (4), France (3) and Germany (3).

## How it works

1. `GROUP BY` puts rows with identical values in the chosen columns into one group.
2. `HAVING COUNT(*) > 1` keeps only groups with more than one member. `HAVING` is needed because `WHERE` runs before grouping and cannot see `COUNT(*)`.
3. The window version computes the same group count but attaches it to each row instead of collapsing them, so you keep IDs and names.

**Removing duplicates** usually means keeping one row per group. Number the rows with `ROW_NUMBER() OVER (PARTITION BY dup_cols ORDER BY id)` and treat every `rn > 1` as a duplicate. This is the same technique as [top N per group](/concepts/top-n-per-group) with N = 1.

**Listing duplicate pairs** is a self-join: join the table to itself on the duplicate columns with `a.id < b.id`. That returns each pair once, as in [Customers Sharing the Same Postal Code](/questions/q70-customers-sharing-the-same-postal-code). See [self join](/concepts/self-join).

## Common mistakes

- **Using `WHERE COUNT(*) > 1`.** Aggregates are not allowed in `WHERE`. Use `HAVING`.
- **Grouping by the primary key.** `GROUP BY customer_id, city` can never find duplicates, because every `customer_id` is unique. Group only by the columns that define "duplicate".
- **NULLs in the key.** `GROUP BY` treats NULLs as equal, so many rows with a NULL `region` form one "duplicate" group. Decide whether that counts, and filter `IS NOT NULL` if not.
- **Case and whitespace.** 'London' and 'london ' are different values. Normalise with `LOWER(TRIM(col))` when the data is messy.
- **Self-join with `<>`.** `a.id <> b.id` returns each pair twice (A-B and B-A). Use `<`.
- **`COUNT(col)` vs `COUNT(*)`.** `COUNT(col)` skips NULLs; see [COUNT(*) vs COUNT(column)](/concepts/count-star-vs-count-column).

## When to use it vs alternatives

| Goal | Pattern |
|---|---|
| List duplicated values and counts | `GROUP BY ... HAVING COUNT(*) > 1` |
| Show every duplicated row with details | `COUNT(*) OVER (PARTITION BY ...)` |
| Keep one row per group / delete extras | `ROW_NUMBER() OVER (PARTITION BY ...)`, keep `rn = 1` |
| Show duplicate pairs | Self-join with `a.id < b.id` |
| Check whether a single row has a twin | `EXISTS` with a correlated subquery |

## Interview questions

### How do you find duplicate rows in SQL?
Group by the columns that should be unique and keep groups with `HAVING COUNT(*) > 1`. To see each duplicate row rather than just the values, compute `COUNT(*) OVER (PARTITION BY those columns)` in a subquery and filter it above 1.

### How do you delete duplicates but keep one row?
Assign `ROW_NUMBER() OVER (PARTITION BY dup_cols ORDER BY id)` in a CTE, then delete rows whose number is greater than 1, joining back on the primary key. The `ORDER BY` decides which copy survives.

### Why use HAVING instead of WHERE here?
`WHERE` filters individual rows before grouping, so the group count does not exist yet. `HAVING` filters after `GROUP BY` and can reference aggregates such as `COUNT(*)`.

### How do you list duplicates as pairs?
Self-join the table on the duplicate columns with `a.id < b.id`. The strict inequality removes self-matches and mirrored pairs.

## Practice

Practice this pattern with the questions below.
