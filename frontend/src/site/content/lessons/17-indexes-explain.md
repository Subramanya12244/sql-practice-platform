---
title: SQL Indexes and EXPLAIN
slug: indexes-explain
order: 17
level: Advanced
description: Speed up SQL with indexes: B-tree basics, composite and partial indexes, and reading PostgreSQL EXPLAIN and EXPLAIN ANALYZE query plans.
related: [q66-customers-from-the-same-country, q67-customers-from-the-same-city, q147-latest-order-per-customer]
---

An index is a separate sorted structure that lets the database find rows without scanning the whole table. `EXPLAIN` shows the plan the planner chose; `EXPLAIN ANALYZE` actually runs the query and adds real timings.

## Syntax

```sql
CREATE INDEX idx_name ON t (col);
CREATE INDEX idx_name ON t (col1, col2);           -- composite
CREATE INDEX idx_name ON t (col) WHERE cond;       -- partial
CREATE UNIQUE INDEX idx_name ON t (col);
CREATE INDEX idx_name ON t (lower(col));           -- expression
DROP INDEX idx_name;

EXPLAIN SELECT ...;
EXPLAIN ANALYZE SELECT ...;
```

Plan nodes to know: `Seq Scan` (read whole table), `Index Scan` / `Index Only Scan`, `Bitmap Heap Scan`, `Nested Loop`, `Hash Join`, `Merge Join`, `Sort`, `HashAggregate`.

## Examples

**Index used for a lookup:** Northwind already has `idx_orders_customer`.

```sql
EXPLAIN SELECT * FROM orders WHERE customer_id = 'ALFKI';
```

On a 100-row table the planner may still pick a `Seq Scan`: reading a few pages is cheaper than using the index. Indexes pay off as tables grow.

**Composite index matching a filter and sort:**

```sql
CREATE INDEX idx_orders_customer_date ON orders (customer_id, order_date DESC);
```

**Partial index for unshipped orders:**

```sql
CREATE INDEX idx_orders_unshipped ON orders (order_date) WHERE shipped_date IS NULL;
```

## Common mistakes

- Wrapping the indexed column in a function (`WHERE lower(city) = 'london'`) skips a plain index; create an expression index instead.
- Composite index column order matters: `(a, b)` helps `WHERE a = ?` but not `WHERE b = ?` alone.
- Too many indexes slow down every `INSERT`/`UPDATE`/`DELETE`.
- `EXPLAIN ANALYZE` executes the statement, including DML. Wrap it in `BEGIN ... ROLLBACK`.

## Exercises

```exercise
prompt: List the index names and definitions on the orders table from pg_indexes.
orderBy: indexname
---
SELECT indexname, indexdef FROM pg_indexes WHERE tablename = 'orders' ORDER BY indexname;
```

```exercise
prompt: Create an expression index on lower(company_name) for customers, then return the indexname from pg_indexes for that new index.
---
CREATE INDEX idx_customers_lower_name ON customers (lower(company_name)); SELECT indexname FROM pg_indexes WHERE indexname = 'idx_customers_lower_name';
```

```exercise
prompt: Show the query plan for selecting all orders of customer 'ALFKI'.
---
EXPLAIN SELECT * FROM orders WHERE customer_id = 'ALFKI';
```
