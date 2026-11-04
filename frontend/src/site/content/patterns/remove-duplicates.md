---
title: Remove duplicates
slug: remove-duplicates
category: dedup
difficulty: Intermediate
description: Delete duplicate rows but keep one per key, using ROW_NUMBER with ctid in PostgreSQL, or keep-the-minimum-id DELETE … USING.
questions: [187, 147]
notes: [row-number, partition-by, cte, transactions]
guides: [find-duplicates]
---

## Problem

A table has several rows with the same business key. Keep exactly one row per key and delete the rest. Northwind has no duplicates, so the example first copies some rows into a temporary table. The runnable blocks run inside a transaction that is rolled back.

## When to use it

- Cleaning a staging table before you add a unique constraint.
- Removing rows loaded twice by a retried import.
- Interview prompt: "delete duplicate emails, keep the lowest id".

## Solution

In PostgreSQL every row has a hidden `ctid` (its physical location), which identifies rows even when they are identical in every column:

```sql
CREATE TEMP TABLE shipper_copy AS
SELECT company_name, phone FROM shippers
UNION ALL
SELECT company_name, phone FROM shippers WHERE shipper_id <= 2;

WITH ranked AS (
  SELECT ctid,
         ROW_NUMBER() OVER (PARTITION BY company_name ORDER BY ctid) AS rn
  FROM shipper_copy
)
DELETE FROM shipper_copy s
USING ranked r
WHERE s.ctid = r.ctid
  AND r.rn > 1
RETURNING s.company_name;
```

## Alternatives

When the table has a unique id, keep the smallest id per key:

```sql
CREATE TEMP TABLE product_copy AS
SELECT product_id AS id, product_name FROM products
UNION ALL
SELECT product_id + 1000, product_name FROM products WHERE product_id <= 3;

DELETE FROM product_copy a
USING product_copy b
WHERE a.product_name = b.product_name
  AND a.id > b.id
RETURNING a.id, a.product_name;
```

Rebuild instead of deleting, which suits very large tables with many duplicates:

```sql
CREATE TEMP TABLE shipper_clean AS
SELECT DISTINCT ON (company_name) shipper_id, company_name, phone
FROM shippers
ORDER BY company_name, shipper_id;

SELECT * FROM shipper_clean;
```

`ctid` is PostgreSQL-specific and changes after `UPDATE` or `VACUUM FULL`, so only use it inside one statement. The self-join `DELETE … USING` is portable in spirit (other databases use different syntax) but needs a unique id. Rebuilding avoids many row deletions but needs a table swap.

## How it works

`ROW_NUMBER() OVER (PARTITION BY key ORDER BY …)` numbers the rows of each key 1, 2, 3, … The `ORDER BY` decides which copy survives as row 1. The `DELETE` joins back to the ranked rows and removes every row whose number is greater than 1. `RETURNING` shows which rows were deleted.

## Execution walkthrough

1. `CREATE TEMP TABLE` builds 3 shippers plus 2 copies, so 5 rows.
2. The CTE partitions by `company_name`. The two duplicated names get rows numbered 1 and 2.
3. `DELETE … USING ranked` matches each table row to its ranked row by `ctid`.
4. `r.rn > 1` keeps only the second copy of each name, so 2 rows are deleted.
5. `RETURNING` lists the 2 deleted names. 3 unique rows remain.

## Common mistakes

- Deleting every row of a duplicated key (`WHERE key IN (… HAVING COUNT(*) > 1)`). That removes the original too.
- No deterministic `ORDER BY` in the window, so a random copy survives.
- Running it outside a transaction first. Run `BEGIN`, check `RETURNING`, then `COMMIT` or `ROLLBACK`.
- Using `ctid` across statements. It is only stable within one statement.

## Performance

The window needs a sort by the partition key, so an index on that key helps. Deleting many rows creates dead tuples, so run `VACUUM` afterwards. When most rows are duplicates, `CREATE TABLE AS SELECT DISTINCT ON …` and a swap is usually faster than `DELETE`.
