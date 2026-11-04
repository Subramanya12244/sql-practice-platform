---
title: Primary and foreign keys
slug: primary-foreign-keys
category: advanced-sql
difficulty: Intermediate
description: How primary keys identify rows and foreign keys link tables, with referential actions, composite keys, surrogate vs natural keys and indexing.
prerequisites: [constraints, inner-join]
related: [constraints, normalization, database-design, self-join, indexes]
questions: [28, 29, 61, 139, 141]
patterns: [unmatched-records, customers-without-orders, self-referencing, hierarchical-queries]
guides: [left-join, self-join]
minutes: 9
version: 1
---

## Introduction

Every join you write follows a key relationship: `orders.customer_id` points to `customers.customer_id`. Keys are how relational data stays connected and consistent.

## Definition

- A **primary key (PK)** uniquely identifies each row. It is `UNIQUE` + `NOT NULL`, and a table has at most one.
- A **foreign key (FK)** is a column (or columns) whose values must exist in a referenced table's primary key or unique column. It enforces **referential integrity**.

## Why it matters

- PKs make rows addressable for updates, joins and de-duplication.
- FKs stop orphans: no order for a non-existent customer.
- The FK graph is the map of the schema for anyone writing joins.
- Interview topics: composite keys, surrogate vs natural keys, `ON DELETE` actions, FK indexing.

## How it works

- Insert/update on the child: the database checks the parent value exists (NULL FK values skip the check).
- Delete/update on the parent: the referential action decides what happens to children:
  - `NO ACTION` (default) / `RESTRICT`: reject if children exist.
  - `CASCADE`: delete/update children too.
  - `SET NULL` / `SET DEFAULT`: reset the child column.
- A self-referencing FK (`employees.reports_to -> employees.employee_id`) models hierarchies.

## Syntax

```sql-syntax
CREATE TABLE parent (
  parent_id integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY
);
CREATE TABLE child (
  child_id  integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  parent_id integer NOT NULL
            REFERENCES parent (parent_id)
            ON DELETE CASCADE ON UPDATE NO ACTION
);
-- composite key
PRIMARY KEY (order_id, product_id)
FOREIGN KEY (a, b) REFERENCES other (a, b)
```

## Simple examples

Northwind's FK map from the catalog:

```sql
SELECT conrelid::regclass  AS child_table,
       confrelid::regclass AS parent_table,
       pg_get_constraintdef(oid) AS definition
FROM pg_constraint
WHERE contype = 'f'
ORDER BY 1::text, 2::text;
```

The composite primary key of `order_details`:

```sql
SELECT conname, pg_get_constraintdef(oid) AS definition
FROM pg_constraint
WHERE conrelid = 'order_details'::regclass AND contype = 'p';
```

## Intermediate examples

An FK rejects orphans. This insert fails because customer `ZZZZZ` does not exist (shown as syntax, since it errors):

```sql-syntax
INSERT INTO orders (customer_id, order_date) VALUES ('ZZZZZ', DATE '1998-01-01');
-- ERROR: insert or update on table "orders" violates foreign key constraint "orders_customer_id_fkey"
```

Rows a parent has no children for (an FK cannot enforce "at least one child"):

```sql
SELECT c.customer_id, c.company_name
FROM customers c
LEFT JOIN orders o ON o.customer_id = c.customer_id
WHERE o.order_id IS NULL;
```

Self-referencing FK: each employee and their manager.

```sql
SELECT e.employee_id, e.first_name || ' ' || e.last_name AS employee,
       m.first_name || ' ' || m.last_name AS manager
FROM employees e
LEFT JOIN employees m ON m.employee_id = e.reports_to
ORDER BY e.employee_id;
```

## Advanced examples

`ON DELETE CASCADE` vs default `NO ACTION`, on temp tables:

```sql
CREATE TEMP TABLE t_orders AS SELECT order_id, customer_id FROM orders;
ALTER TABLE t_orders ADD PRIMARY KEY (order_id);
CREATE TEMP TABLE t_lines AS SELECT order_id, product_id, quantity FROM order_details;
ALTER TABLE t_lines ADD PRIMARY KEY (order_id, product_id),
  ADD FOREIGN KEY (order_id) REFERENCES t_orders (order_id) ON DELETE CASCADE;

DELETE FROM t_orders WHERE customer_id = 'ALFKI';
SELECT COUNT(*) AS remaining_alfki_lines
FROM t_lines l
WHERE l.order_id IN (SELECT order_id FROM orders WHERE customer_id = 'ALFKI');
```

The lines were deleted with their orders. Without `CASCADE` the `DELETE` would fail.

Check which FK columns lack a supporting index (they slow parent deletes and joins):

```sql
SELECT c.conrelid::regclass AS table_name,
       a.attname            AS fk_column,
       EXISTS (SELECT 1 FROM pg_index i
               WHERE i.indrelid = c.conrelid AND i.indkey[0] = c.conkey[1]) AS has_index
FROM pg_constraint c
JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = c.conkey[1]
WHERE c.contype = 'f'
ORDER BY has_index, 1::text;
```

## Real-world scenarios

- `ON DELETE CASCADE` for owned children (order lines), `RESTRICT` for referenced master data (customers, products).
- Soft deletes (`deleted_at`) instead of physical deletes when history matters.
- Junction tables with a composite PK for many-to-many (`order_details` links orders and products).
- Surrogate identity keys plus a `UNIQUE` natural key (e.g. `sku`).

## PostgreSQL specifics

- PostgreSQL does **not** index FK columns automatically. MySQL InnoDB does.
- Prefer `GENERATED ... AS IDENTITY` (standard SQL) over `SERIAL` (PostgreSQL legacy shorthand) for new tables.
- FKs can be `DEFERRABLE INITIALLY DEFERRED` to insert cyclic data in one transaction.
- `NOT VALID` adds an FK without checking old rows; `VALIDATE CONSTRAINT` checks later.
- `TRUNCATE` of a referenced table fails unless the children are truncated too or `CASCADE` is given.

## Visual explanation

```text
customers                orders                     order_details
+-------------+         +--------------+           +--------------------+
| customer_id |PK<--+   | order_id     |PK<----+   | order_id      PK,FK|
| company_name|     +---| customer_id  |FK     +---| product_id    PK,FK|--> products
+-------------+         | employee_id  |FK--> employees(reports_to FK -> self)
                        | ship_via     |FK--> shippers
                        +--------------+
1 customer : N orders ; 1 order : N lines ; orders N : M products via order_details
```

## Common mistakes

- No index on FK columns, then slow joins and parent deletes.
- `CASCADE` everywhere: one delete wipes far more than intended.
- Natural keys that change (email, company name) used as PKs.
- Nullable FK when the relationship is mandatory; add `NOT NULL`.
- Thinking an FK guarantees every parent has children.

## Performance

- Joins on PK/FK are the most common join; index both sides.
- FK checks cost one index lookup per inserted child row.
- Deleting a parent scans children for references; without an index that is a sequential scan per row.
- Narrow integer surrogate keys keep indexes small.

## Interview questions

### Primary key vs unique key?

Both enforce uniqueness with an index. A PK is also `NOT NULL` and there is one per table; it is the row's identity. Unique keys can be many and allow NULLs.

### Surrogate or natural key?

Surrogate keys (identity integers or UUIDs) never change and are compact. Natural keys carry meaning but can change. Common practice: surrogate PK plus a `UNIQUE` constraint on the natural key.

### What does ON DELETE CASCADE do?

Deleting a parent row automatically deletes the child rows that reference it. The default, `NO ACTION`, rejects the delete instead.

### Can a foreign key be NULL?

Yes. A NULL FK means "no parent" and is not checked. Add `NOT NULL` when the relationship is required.

### Does PostgreSQL index foreign keys?

No. Only the referenced key needs a unique index. Index the referencing column yourself.

## Quick revision

- PK = UNIQUE + NOT NULL, one per table.
- FK = value must exist in parent; NULL allowed unless NOT NULL.
- Actions: NO ACTION (default), RESTRICT, CASCADE, SET NULL, SET DEFAULT.
- Composite PK for junction tables.
- Index FK columns yourself in PostgreSQL.
- Prefer IDENTITY over SERIAL for new tables.
