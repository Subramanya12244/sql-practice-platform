---
title: Find duplicates
slug: find-duplicates
category: dedup
difficulty: Beginner
description: Find rows that share the same key values with GROUP BY … HAVING COUNT(*) > 1 or COUNT(*) OVER (PARTITION BY …).
questions: [64, 66, 67, 70]
notes: [group-by, having, count, partition-by]
guides: [find-duplicates]
---

## Problem

Find values that appear more than once in columns that should be unique, for example two contact rows with the same email. Northwind has no natural duplicate rows, so the examples build a small table with a CTE.

## When to use it

- Data-quality checks before you add a unique constraint.
- Interview prompts such as "find duplicate emails" or "customers sharing a city".
- Checking a join for fan-out (one key matching several rows).

## Solution

```sql
WITH contacts(contact_id, email) AS (
  SELECT customer_id, lower(contact_name) || '@example.com' FROM customers
  UNION ALL
  SELECT 'DUP' || customer_id, lower(contact_name) || '@example.com'
  FROM customers WHERE customer_id IN ('ALFKI', 'BONAP')
)
SELECT email, COUNT(*) AS copies
FROM contacts
GROUP BY email
HAVING COUNT(*) > 1
ORDER BY copies DESC, email;
```

## Alternatives

Return every duplicated row in full with a window count:

```sql
WITH contacts(contact_id, email) AS (
  SELECT customer_id, lower(contact_name) || '@example.com' FROM customers
  UNION ALL
  SELECT 'DUP' || customer_id, lower(contact_name) || '@example.com'
  FROM customers WHERE customer_id IN ('ALFKI', 'BONAP')
)
SELECT *
FROM (
  SELECT c.*, COUNT(*) OVER (PARTITION BY email) AS copies
  FROM contacts c
) t
WHERE copies > 1
ORDER BY email, contact_id;
```

Real Northwind data: customers that share a country and city (a duplicate *value*, not a bad row):

```sql
SELECT country, city, COUNT(*) AS customers
FROM customers
GROUP BY country, city
HAVING COUNT(*) > 1
ORDER BY customers DESC;
```

`GROUP BY` returns one row per duplicated value. The window version keeps every row and its id, so you can see which rows to fix. That costs more, because every row is returned.

## How it works

`GROUP BY` collapses rows with equal keys into one group. `HAVING` filters groups after aggregation, so `COUNT(*) > 1` keeps only keys that occur more than once. `COUNT(*) OVER (PARTITION BY key)` computes the same count but attaches it to every row instead of collapsing them.

## Execution walkthrough

1. The CTE builds the customer emails, then appends 2 copies with `UNION ALL`.
2. `GROUP BY email` forms one group per distinct email.
3. `COUNT(*)` counts rows per group. The two copied emails get 2.
4. `HAVING COUNT(*) > 1` drops all groups with a count of 1.
5. `ORDER BY` sorts the remaining duplicated emails.

## Common mistakes

- Putting `COUNT(*) > 1` in `WHERE`. Aggregates are not allowed there, so use `HAVING`.
- Grouping by the primary key as well. Each group then has one row, so nothing is found.
- Forgetting case and whitespace. `'A@x.com'` and `'a@x.com '` are different strings unless you normalise them with `lower(trim(...))`.
- NULL keys form a single group in `GROUP BY`. Decide whether NULLs count as duplicates.

## Performance

Both forms need a sort or a hash over the key columns. An index on those columns lets PostgreSQL group from an ordered scan. On large tables `GROUP BY` is cheaper than the window form, because the window form must return every row.
