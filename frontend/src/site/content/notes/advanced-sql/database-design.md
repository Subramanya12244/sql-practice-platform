---
title: Database design
slug: database-design
category: advanced-sql
difficulty: Expert
description: Design relational schemas from requirements: entities, cardinality, keys, data types, constraints, indexes and OLTP vs OLAP trade-offs, using Northwind.
prerequisites: [normalization, primary-foreign-keys, constraints]
related: [normalization, primary-foreign-keys, constraints, indexes, views, jsonb, join-cardinality]
questions: [41, 61, 86, 190, 191]
patterns: [self-referencing, hierarchical-queries]
guides: []
minutes: 11
version: 1
---

## Introduction

A schema outlives every application written against it. Good design makes queries simple and bad data impossible; bad design forces workarounds in every query.

## Definition

Database design is turning requirements into tables, columns, types, keys, constraints and indexes. It moves from a conceptual model (entities and relationships, usually an ER diagram) to a logical model (normalised tables) to a physical model (types, indexes, partitioning).

## Why it matters

- System-design and data-engineering interviews ask you to design a schema live.
- Cardinality mistakes cause duplicate rows in joins and wrong totals.
- Type and constraint choices decide data quality for years.

## How it works

1. **Entities**: nouns in the requirements (customer, order, product, employee).
2. **Relationships and cardinality**: 1:1, 1:N (FK on the N side), M:N (junction table).
3. **Keys**: surrogate PK, natural key as `UNIQUE`.
4. **Attributes and types**: `numeric` for money, `date`/`timestamptz` for time, `text` with `CHECK` for codes.
5. **Constraints**: NOT NULL, CHECK, FK actions.
6. **Indexes** for the actual query patterns.
7. **Workload**: OLTP (normalised) vs OLAP (star schema).

## Syntax

```sql-syntax
CREATE TABLE customer (
  customer_id  bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  email        text NOT NULL UNIQUE,
  created_at   timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE "order" (
  order_id     bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  customer_id  bigint NOT NULL REFERENCES customer,
  status       text NOT NULL CHECK (status IN ('new','paid','shipped','cancelled')),
  ordered_at   timestamptz NOT NULL
);
CREATE INDEX ON "order" (customer_id, ordered_at DESC);
```

## Simple examples

Inspect Northwind's tables and row counts:

```sql
SELECT relname AS table_name, n_live_tup AS approx_rows
FROM pg_stat_user_tables
ORDER BY relname;
```

Column types chosen for `orders`:

```sql
SELECT column_name, data_type, is_nullable, column_default
FROM information_schema.columns
WHERE table_name = 'orders'
ORDER BY ordinal_position;
```

## Intermediate examples

Check real cardinality: is customers -> orders 1:N, and how many customers have zero orders?

```sql
SELECT MIN(n) AS min_orders, MAX(n) AS max_orders,
       COUNT(*) FILTER (WHERE n = 0) AS customers_with_none
FROM (
  SELECT c.customer_id, COUNT(o.order_id) AS n
  FROM customers c LEFT JOIN orders o ON o.customer_id = c.customer_id
  GROUP BY c.customer_id
) t;
```

M:N via a junction table: products and orders meet in `order_details`.

```sql
SELECT p.product_name, COUNT(DISTINCT od.order_id) AS orders
FROM products p
LEFT JOIN order_details od ON od.product_id = p.product_id
GROUP BY p.product_name
ORDER BY orders, p.product_name
LIMIT 5;
```

## Advanced examples

Prototype a design improvement inside a transaction: an order-status column derived from dates, with a `CHECK`.

```sql
ALTER TABLE orders ADD COLUMN status text;
UPDATE orders SET status = CASE WHEN shipped_date IS NULL THEN 'pending' ELSE 'shipped' END;
ALTER TABLE orders ALTER COLUMN status SET NOT NULL,
  ADD CONSTRAINT chk_order_status CHECK (status IN ('pending', 'shipped', 'cancelled'));
SELECT status, COUNT(*) FROM orders GROUP BY status ORDER BY status;
```

A small star schema for analytics, built from the OLTP tables:

```sql
CREATE TEMP TABLE dim_date AS
SELECT d::date AS date_key, EXTRACT(YEAR FROM d)::int AS year,
       EXTRACT(QUARTER FROM d)::int AS quarter, EXTRACT(MONTH FROM d)::int AS month
FROM generate_series((SELECT MIN(order_date) FROM orders),
                     (SELECT MAX(order_date) FROM orders), INTERVAL '1 day') AS d;

CREATE TEMP TABLE fact_sales AS
SELECT o.order_date AS date_key, o.customer_id, od.product_id, p.category_id,
       od.quantity, od.unit_price * od.quantity * (1 - od.discount) AS revenue
FROM orders o
JOIN order_details od ON od.order_id = o.order_id
JOIN products p ON p.product_id = od.product_id;

SELECT d.year, d.quarter, ROUND(SUM(f.revenue)::numeric, 2) AS revenue
FROM fact_sales f JOIN dim_date d ON d.date_key = f.date_key
GROUP BY d.year, d.quarter
ORDER BY d.year, d.quarter;
```

Hierarchy via self-reference (employees -> manager), walked with a recursive CTE:

```sql
WITH RECURSIVE chain AS (
  SELECT employee_id, first_name, reports_to, 0 AS depth
  FROM employees WHERE reports_to IS NULL
  UNION ALL
  SELECT e.employee_id, e.first_name, e.reports_to, c.depth + 1
  FROM employees e JOIN chain c ON e.reports_to = c.employee_id
)
SELECT * FROM chain ORDER BY depth, employee_id;
```

## Real-world scenarios

- E-commerce: customers, addresses (1:N), orders, order lines, products, categories, payments.
- SaaS multi-tenancy: `tenant_id` on every table, in every PK/index, optionally with row-level security.
- Audit/history: append-only tables or `valid_from`/`valid_to` periods.
- Analytics: star schema with fact tables at a clear grain (one row per order line).

## PostgreSQL specifics

- Types: `numeric` for money (not `float`/`real`; Northwind's `discount REAL` is a legacy choice), `timestamptz` for events, `text` instead of arbitrary `varchar(n)` limits (same performance in PostgreSQL), `uuid` for distributed keys, `jsonb` for flexible attributes, enums or lookup tables for statuses.
- `GENERATED ALWAYS AS IDENTITY` is the standard replacement for `SERIAL`.
- Avoid reserved words as names (`order`, `user`) or you must quote them forever.
- Schemas (`CREATE SCHEMA`) namespace tables; declarative partitioning splits very large tables by range/list/hash.
- Row-level security (`CREATE POLICY`) enforces per-tenant access in the database.

## Visual explanation

```text
             reports_to (self 1:N)
            +-----------+
            v           |
 categories  employees--+     shippers
     |1          |1              |1
     |N          |N              |N
 products   N:M  orders  N:1  customers
     |1    \      /1
     |N     \    /N
 suppliers?  order_details   (junction, PK = order_id + product_id)
 (suppliers 1:N products)
```

| Question to ask | Example decision |
|---|---|
| What is the grain? | one row per order line |
| Who references whom? | FK on the "many" side |
| What must never be NULL? | order.customer_id, order_date |
| What will be queried most? | orders by customer and date: composite index |
| What changes over time? | price: copy into order line at sale time |

## Common mistakes

- Money in `float`: rounding errors.
- Missing junction table, storing lists in a column.
- Ambiguous grain in fact tables, causing double counting.
- Timestamps without time zone for global events.
- Generic EAV (`entity, attribute, value`) tables that make every query a pivot.
- Designing without the main queries in mind, then indexing blindly.

## Performance

- Design indexes from the top queries, not from columns.
- Narrow keys (`bigint`) keep indexes and FKs compact; random UUIDv4 keys fragment B-trees more than sequential keys.
- Partition only very large tables with a natural range key (time).
- Read-heavy reporting: materialized views or a separate star schema.

## Interview questions

### How would you model a many-to-many relationship?

With a junction table holding FKs to both sides and a composite primary key (or a surrogate key plus `UNIQUE` on the pair), like `order_details(order_id, product_id)`.

### How do you store an employee hierarchy?

A self-referencing FK (`reports_to -> employee_id`) and recursive CTEs to traverse it. Alternatives for heavy read workloads: materialized path, `ltree`, or closure tables.

### OLTP vs OLAP schema?

OLTP is normalised for many small consistent writes. OLAP uses denormalised star or snowflake schemas (facts + dimensions) for large scans and aggregations.

### Which type for money and why?

`numeric(p, s)`: exact decimal arithmetic. Floating types cannot represent most decimal fractions exactly.

### How do you keep historical prices?

Copy the price into the order line at sale time, or keep a price history table with validity periods.

## Quick revision

- Requirements -> entities -> cardinality -> keys -> types -> constraints -> indexes.
- 1:N = FK on N side; M:N = junction table.
- Surrogate PK + UNIQUE natural key.
- `numeric` for money, `timestamptz` for events, IDENTITY for keys.
- Define the grain of fact tables.
- OLTP normalised, OLAP star schema.
- Index for real queries.
