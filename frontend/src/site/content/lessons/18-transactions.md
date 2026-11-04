---
title: SQL Transactions and Isolation Levels
slug: transactions
order: 18
level: Advanced
description: Understand SQL transactions: BEGIN, COMMIT, ROLLBACK, SAVEPOINT, ACID, and PostgreSQL isolation levels from READ COMMITTED to SERIALIZABLE.
related: [q163-unshipped-orders-older-than-30-days]
---

A transaction groups statements so they succeed or fail together. Transactions give you ACID: Atomicity (all or nothing), Consistency (constraints hold), Isolation (concurrent transactions do not see each other's partial work), Durability (committed data survives crashes).

## Syntax

```sql
BEGIN;                         -- or START TRANSACTION
  ...statements...
  SAVEPOINT sp;
  ...
  ROLLBACK TO SAVEPOINT sp;    -- undo back to the savepoint
COMMIT;                        -- or ROLLBACK;

BEGIN ISOLATION LEVEL REPEATABLE READ;
SELECT ... FOR UPDATE;         -- lock rows you intend to change
```

## Isolation levels in PostgreSQL

| Level | Dirty read | Non-repeatable read | Phantom read | Serialization anomaly |
|---|---|---|---|---|
| `READ COMMITTED` (default) | no | possible | possible | possible |
| `REPEATABLE READ` | no | no | no (in PostgreSQL) | possible |
| `SERIALIZABLE` | no | no | no | no |

`READ UNCOMMITTED` is accepted but behaves like `READ COMMITTED`. Under `REPEATABLE READ` and `SERIALIZABLE`, conflicting transactions may fail with a serialization error and must be retried.

## Examples

**Move stock atomically:**

```sql
BEGIN;
UPDATE products SET units_in_stock = units_in_stock - 10 WHERE product_id = 1;
UPDATE products SET units_in_stock = units_in_stock + 10 WHERE product_id = 2;
COMMIT;
```

**Savepoint to undo part of the work:**

```sql
BEGIN;
UPDATE products SET unit_price = unit_price * 1.1 WHERE category_id = 1;
SAVEPOINT before_delete;
DELETE FROM order_details WHERE quantity < 5;
ROLLBACK TO SAVEPOINT before_delete;   -- the delete is undone, the update stays
COMMIT;
```

**Lock a row before changing it:**

```sql
BEGIN;
SELECT units_in_stock FROM products WHERE product_id = 1 FOR UPDATE;
UPDATE products SET units_in_stock = units_in_stock - 1 WHERE product_id = 1;
COMMIT;
```

## Common mistakes

- After an error inside a transaction, PostgreSQL rejects further statements until `ROLLBACK` (or `ROLLBACK TO SAVEPOINT`).
- Long-running transactions hold locks and block vacuum. Keep them short.
- Read-then-write without `FOR UPDATE` (or a stricter isolation level) can lose concurrent updates.
- Forgetting that DDL in PostgreSQL is transactional too: a rolled-back `CREATE TABLE` disappears.

## Exercises

The practice runner already wraps your SQL in a transaction that is rolled back, so use savepoints to experiment.

```exercise
prompt: Move 10 units of stock from product 1 to product 2 and return product_id and units_in_stock of both products.
orderBy: product_id
---
UPDATE products SET units_in_stock = units_in_stock - 10 WHERE product_id = 1; UPDATE products SET units_in_stock = units_in_stock + 10 WHERE product_id = 2; SELECT product_id, units_in_stock FROM products WHERE product_id IN (1, 2) ORDER BY product_id;
```

```exercise
prompt: Create a savepoint, delete all order_details, roll back to the savepoint, then return the count of order_details rows as line_count.
---
SAVEPOINT sp; DELETE FROM order_details; ROLLBACK TO SAVEPOINT sp; SELECT COUNT(*) AS line_count FROM order_details;
```

```exercise
prompt: Show the current transaction isolation level.
---
SHOW transaction_isolation;
```
