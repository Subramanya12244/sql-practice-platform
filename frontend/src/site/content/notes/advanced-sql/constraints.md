---
title: Constraints
slug: constraints
category: advanced-sql
difficulty: Intermediate
description: Enforce data rules in the database with NOT NULL, UNIQUE, CHECK, PRIMARY KEY, FOREIGN KEY, DEFAULT and PostgreSQL exclusion constraints.
prerequisites: [select, null-handling]
related: [primary-foreign-keys, transactions, indexes, normalization, database-design]
questions: [188, 190, 191]
patterns: [find-duplicates]
guides: []
minutes: 9
version: 1
---

## Introduction

Application checks get bypassed by scripts, imports and bugs. Constraints make the database itself reject bad data, for every client, always.

## Definition

A constraint is a rule on a column or table that every row must satisfy. Standard SQL defines `NOT NULL`, `UNIQUE`, `PRIMARY KEY`, `FOREIGN KEY` and `CHECK`. `DEFAULT` is not a constraint but is declared alongside. PostgreSQL adds `EXCLUDE` constraints.

## Why it matters

- Data quality guaranteed at the source.
- Constraints document intent in the schema.
- The planner can use them (unique indexes, `NOT NULL`, join removal).
- Interview staples: `UNIQUE` vs `PRIMARY KEY`, NULLs in `UNIQUE`, `CHECK` limitations.

## How it works

- Checked on every `INSERT`/`UPDATE` (and `DELETE` for referenced FKs). A violation aborts the statement.
- `UNIQUE` and `PRIMARY KEY` are backed by unique B-tree indexes.
- `CHECK (expr)` passes when expr is TRUE **or NULL**.
- Constraints can be added later with `ALTER TABLE ... ADD CONSTRAINT`; existing rows are validated unless `NOT VALID` is used (CHECK and FK only).
- `UNIQUE`, `PRIMARY KEY`, FK and `EXCLUDE` can be `DEFERRABLE`, checked at commit instead of per statement.

## Syntax

```sql-syntax
CREATE TABLE t (
  id     integer PRIMARY KEY,
  email  text NOT NULL UNIQUE,
  price  numeric CHECK (price >= 0),
  status text DEFAULT 'new',
  parent integer REFERENCES t(id) ON DELETE SET NULL,
  CONSTRAINT price_vs_cost CHECK (price >= cost)
);

ALTER TABLE t ADD CONSTRAINT name CHECK (...) [NOT VALID];
ALTER TABLE t VALIDATE CONSTRAINT name;
ALTER TABLE t DROP CONSTRAINT name;
```

## Simple examples

List the constraints on `products` from the catalog (`contype`: p = primary, f = foreign, c = check, u = unique):

```sql
SELECT conname, contype, pg_get_constraintdef(oid) AS definition
FROM pg_constraint
WHERE conrelid = 'products'::regclass
ORDER BY contype, conname;
```

Add a `CHECK` and confirm current data satisfies it:

```sql
ALTER TABLE products ADD CONSTRAINT chk_price_nonneg CHECK (unit_price >= 0);
SELECT conname, pg_get_constraintdef(oid)
FROM pg_constraint WHERE conname = 'chk_price_nonneg';
```

## Intermediate examples

Add a column, backfill it, then make it `NOT NULL` with a `CHECK` on allowed values:

```sql
ALTER TABLE products ADD COLUMN stock_status text;
UPDATE products SET stock_status = CASE
  WHEN units_in_stock = 0 THEN 'out'
  WHEN units_in_stock < reorder_level THEN 'low'
  ELSE 'ok' END;
ALTER TABLE products ALTER COLUMN stock_status SET NOT NULL;
ALTER TABLE products ADD CONSTRAINT chk_stock_status CHECK (stock_status IN ('out', 'low', 'ok'));
SELECT stock_status, COUNT(*) FROM products GROUP BY stock_status ORDER BY stock_status;
```

Find duplicates before adding a `UNIQUE` constraint (otherwise `ADD CONSTRAINT` fails):

```sql
SELECT city, country, COUNT(*) AS n
FROM customers
GROUP BY city, country
HAVING COUNT(*) > 1
ORDER BY n DESC;
```

## Advanced examples

`UNIQUE` allows multiple NULLs by default:

```sql
CREATE TEMP TABLE emails (email text UNIQUE);
INSERT INTO emails VALUES ('a@x.com'), (NULL), (NULL);
SELECT * FROM emails;
```

PostgreSQL 15+ can treat NULLs as equal, so a second NULL would be rejected:

```sql-syntax
CREATE TABLE emails (alt text, UNIQUE NULLS NOT DISTINCT (alt));
```

Exclusion constraint: no two promotion periods may overlap (PostgreSQL-only). Per-product rules such as `EXCLUDE USING gist (product_id WITH =, valid WITH &&)` also need the `btree_gist` extension for the `=` part.

```sql
CREATE TEMP TABLE promo_periods (
  name text,
  valid daterange,
  EXCLUDE USING gist (valid WITH &&)
);
INSERT INTO promo_periods VALUES
  ('spring', '[1997-03-01,1997-06-01)'), ('summer', '[1997-06-01,1997-09-01)')
RETURNING *;
```

Inserting `('overlap', '[1997-05-01,1997-07-01)')` would fail with a conflicting-key error.

Add a constraint without scanning existing rows now, validate later:

```sql
ALTER TABLE orders ADD CONSTRAINT chk_ship_after_order
  CHECK (shipped_date IS NULL OR shipped_date >= order_date) NOT VALID;
ALTER TABLE orders VALIDATE CONSTRAINT chk_ship_after_order;
SELECT conname, convalidated FROM pg_constraint WHERE conname = 'chk_ship_after_order';
```

## Real-world scenarios

- `CHECK (quantity > 0)`, `CHECK (discount BETWEEN 0 AND 1)` on order lines.
- `UNIQUE (lower(email))` via a unique expression index.
- Exclusion constraints for room bookings and price validity periods.
- `NOT VALID` + `VALIDATE` to add rules to large live tables with less locking.

## PostgreSQL specifics

- `CHECK` cannot reference other rows or tables (no subqueries). Use triggers or FKs for that.
- `UNIQUE NULLS NOT DISTINCT` is PostgreSQL 15+.
- `EXCLUDE USING gist` is PostgreSQL-only.
- Unique constraints are checked per row by default, not at statement end; `DEFERRABLE` changes that.
- SQL Server allows only one NULL in a `UNIQUE` column; PostgreSQL and the standard allow many.
- MySQL ignored `CHECK` before 8.0.16.

## Visual explanation

| Constraint | Rule | NULL allowed? | Creates index? |
|---|---|---|---|
| NOT NULL | value required | no | no |
| UNIQUE | no duplicate values | yes (many, by default) | yes |
| PRIMARY KEY | UNIQUE + NOT NULL, one per table | no | yes |
| FOREIGN KEY | value exists in parent | yes | no (index it yourself) |
| CHECK | expression not FALSE | yes (NULL passes) | no |
| EXCLUDE | no two rows conflict by operators | depends | yes (GiST/B-tree) |

## Common mistakes

- Forgetting that `CHECK (price > 0)` lets `NULL` through; add `NOT NULL` too.
- Adding `UNIQUE` on dirty data without de-duplicating first.
- Relying only on app validation.
- Unnamed constraints: auto-generated names make errors and migrations harder to read.
- Expecting `CHECK` with a subquery to work.

## Performance

- Constraint checks are cheap compared with fixing bad data.
- `UNIQUE`/PK indexes speed lookups too.
- FK checks need an index on the referenced key (guaranteed) and benefit from one on the referencing column for deletes/updates of the parent.
- Validating a constraint on a big table scans it; use `NOT VALID` then `VALIDATE` (lighter lock).

## Interview questions

### UNIQUE vs PRIMARY KEY?

Both reject duplicates and create a unique index. A primary key also implies `NOT NULL`, and a table has at most one. A table can have many `UNIQUE` constraints, which allow NULLs.

### Does a CHECK constraint reject NULL?

No. `CHECK` fails only when the expression is FALSE. NULL makes it unknown, which passes. Add `NOT NULL` to forbid NULLs.

### How many NULLs can a UNIQUE column hold?

In PostgreSQL and standard SQL, any number, because NULLs are not equal. PostgreSQL 15+ offers `NULLS NOT DISTINCT` to allow only one. SQL Server allows one.

### How do you add a constraint to a huge table safely?

Add it `NOT VALID` (new rows checked immediately, no full scan), then `VALIDATE CONSTRAINT` later with a weaker lock.

## Quick revision

- NOT NULL, UNIQUE, PRIMARY KEY, FOREIGN KEY, CHECK (+ PostgreSQL EXCLUDE).
- CHECK passes on NULL.
- UNIQUE allows many NULLs unless `NULLS NOT DISTINCT`.
- PK = UNIQUE + NOT NULL, one per table.
- Name your constraints.
- `NOT VALID` then `VALIDATE` for large tables.
