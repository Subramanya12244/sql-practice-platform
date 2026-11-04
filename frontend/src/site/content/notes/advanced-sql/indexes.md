---
title: Indexes
slug: indexes
category: advanced-sql
difficulty: Advanced
description: How B-tree, GIN and other PostgreSQL indexes speed up lookups, joins and sorts, when they are ignored, and what they cost on writes.
prerequisites: [where, order-by, inner-join]
related: [query-optimization, constraints, primary-foreign-keys, jsonb]
questions: [3, 26, 147, 167]
patterns: [latest-record-per-group, top-n-per-group]
guides: []
minutes: 10
version: 1
---

## Introduction

Without an index, finding one customer's orders means reading every order. An index is a sorted lookup structure that jumps straight to matching rows.

## Definition

An index is a separate data structure that maps column values to row locations. PostgreSQL index types: B-tree (default), Hash, GIN, GiST, SP-GiST and BRIN. Indexes are not part of standard SQL; `CREATE INDEX` is a universal vendor extension.

## Why it matters

- Turns full scans into lookups on large tables.
- Supports joins on foreign keys, `ORDER BY ... LIMIT`, and uniqueness.
- Every index slows `INSERT`/`UPDATE`/`DELETE` and uses disk.
- Interviewers ask: composite column order, why an index was not used, covering indexes.

## How it works

- B-tree keeps keys sorted, so it serves `=`, `<`, `>`, `BETWEEN`, `IN`, `IS NULL`, prefix `LIKE` (with suitable collation/opclass) and `ORDER BY`.
- A composite index `(a, b)` is sorted by `a` then `b`: it helps filters on `a` or `a AND b`, rarely on `b` alone.
- The planner uses statistics to pick between Seq Scan, Index Scan, Index Only Scan and Bitmap Heap Scan. On small tables a Seq Scan is usually cheapest.
- `PRIMARY KEY` and `UNIQUE` create B-tree indexes automatically. Foreign keys do not.

## Syntax

```sql-syntax
CREATE [UNIQUE] INDEX [CONCURRENTLY] [IF NOT EXISTS] idx_name
  ON table_name [USING btree | hash | gin | gist | brin] (col [DESC] [NULLS LAST], ...)
  [INCLUDE (extra_col, ...)]
  [WHERE predicate];

DROP INDEX [CONCURRENTLY] idx_name;
```

## Simple examples

List the indexes that already exist in this Northwind:

```sql
SELECT tablename, indexname, indexdef
FROM pg_indexes
WHERE schemaname = 'public'
ORDER BY tablename, indexname;
```

Create an index on `orders(order_date)` and see whether the planner uses it. With only 100 orders, a sequential scan may still win; that is correct behaviour:

```sql
CREATE INDEX idx_orders_order_date ON orders (order_date);
ANALYZE orders;
EXPLAIN SELECT * FROM orders WHERE order_date >= DATE '1998-05-01';
```

## Intermediate examples

Composite index matching "latest order per customer" (equality column first, sort column second):

```sql
CREATE INDEX idx_orders_cust_date ON orders (customer_id, order_date DESC);
SET LOCAL enable_seqscan = off;   -- only to demonstrate on a tiny table
EXPLAIN
SELECT order_id, order_date FROM orders
WHERE customer_id = 'ALFKI'
ORDER BY order_date DESC
LIMIT 1;
```

`SET LOCAL` lasts only to the end of the transaction. Never disable seq scans in production.

Partial index for a hot subset (unshipped orders):

```sql
CREATE INDEX idx_orders_unshipped ON orders (order_date) WHERE shipped_date IS NULL;
SELECT indexname, indexdef FROM pg_indexes WHERE indexname = 'idx_orders_unshipped';
```

## Advanced examples

Expression index: a filter on `LOWER(company_name)` can only use an index on that exact expression.

```sql
CREATE INDEX idx_customers_lower_name ON customers (LOWER(company_name));
ANALYZE customers;
SET LOCAL enable_seqscan = off;
EXPLAIN SELECT customer_id FROM customers WHERE LOWER(company_name) = 'alfreds futterkiste';
```

Covering index with `INCLUDE` enables an Index Only Scan (when the visibility map allows):

```sql
CREATE INDEX idx_od_product_cover ON order_details (product_id) INCLUDE (quantity, unit_price);
ANALYZE order_details;
SET LOCAL enable_seqscan = off;
EXPLAIN SELECT product_id, SUM(quantity) FROM order_details WHERE product_id = 11 GROUP BY product_id;
```

The planner may show an Index Only Scan, but heap fetches stay high until `VACUUM` updates the visibility map. `VACUUM` cannot run inside a transaction block, so it is not part of this runnable example.

Index size versus table size:

```sql
SELECT relname,
       pg_size_pretty(pg_relation_size(oid)) AS size
FROM pg_class
WHERE relname IN ('order_details', 'order_details_pkey', 'idx_order_details_product')
ORDER BY relname;
```

## Real-world scenarios

- Index every foreign key column used in joins or cascaded deletes.
- `(customer_id, created_at DESC)` for "latest N per customer" APIs.
- Partial indexes on `status = 'pending'` queues.
- GIN on `jsonb` or full-text `tsvector` columns; BRIN on huge append-only time-series tables.

## PostgreSQL specifics

- `CREATE INDEX CONCURRENTLY` avoids blocking writes but cannot run inside a transaction block.
- PostgreSQL has no clustered index; `CLUSTER` reorders a table once and is not maintained. SQL Server and MySQL InnoDB do cluster by primary key.
- Index Only Scans depend on the visibility map, maintained by `VACUUM`.
- Multicolumn B-tree can sometimes skip leading columns only with PostgreSQL 18's skip scan; do not rely on it in 16.
- Unused indexes show `idx_scan = 0` in `pg_stat_user_indexes`.

## Visual explanation

```text
B-tree on orders(customer_id, order_date DESC)

            [ ANTON | HANAR | QUICK ]
           /        |        |       \
   [ALFKI..]   [ANTON..]  [HANAR..]  [QUICK..]
   ALFKI 1997-08-08 -> row       <- WHERE customer_id='ALFKI'
   ALFKI 1996-01-01 -> row          ORDER BY order_date DESC LIMIT 1
   ANATR 1998-09-09 -> row          = first matching leaf entry, stop
   ANATR 1997-02-02 -> row
```

## Common mistakes

- Indexing every column "just in case": slower writes, more storage, no gain.
- Wrong composite order: `(order_date, customer_id)` does not help `WHERE customer_id = ?` well.
- Wrapping the column in a function or cast (`WHERE order_date::text LIKE '1997%'`).
- Expecting an index on a tiny table or a low-selectivity filter to be used.
- Forgetting that foreign keys are not indexed automatically in PostgreSQL.

## Performance

- Rule of thumb: equality columns first, then range/sort columns.
- Selectivity matters; returning a large fraction of a table favours a Seq Scan.
- Each index adds write amplification and can block HOT updates.
- Check usage with `pg_stat_user_indexes` and plans with `EXPLAIN (ANALYZE, BUFFERS)`.

## Interview questions

### Why would PostgreSQL ignore an index?

The table is small, the filter matches many rows, statistics are stale, the column is wrapped in a function or cast, types mismatch, or the composite index's leading column is not filtered.

### How do you choose the order of columns in a composite index?

Put equality-filtered columns first, then the range or `ORDER BY` column. The index supports any leftmost prefix.

### What is a covering index?

An index that contains every column the query needs, so the table heap need not be read. In PostgreSQL use `INCLUDE` for non-key payload columns.

### Clustered vs non-clustered?

A clustered index stores table rows in index order (SQL Server, MySQL InnoDB). PostgreSQL tables are heaps; all indexes are secondary.

### Does a foreign key create an index?

Not in PostgreSQL. The referenced side needs a unique index; the referencing column should usually be indexed by you.

## Quick revision

- B-tree default: equality, range, sort, prefix.
- Composite = leftmost prefix rule.
- Partial, expression and `INCLUDE` indexes are precise tools.
- PK/UNIQUE auto-index; FK does not.
- Indexes cost writes and space.
- Small tables: Seq Scan is normal.
