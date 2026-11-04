---
title: Transactions
slug: transactions
category: advanced-sql
difficulty: Advanced
description: ACID, BEGIN/COMMIT/ROLLBACK, savepoints, isolation levels and MVCC in PostgreSQL, with the anomalies each level prevents.
prerequisites: [select, constraints]
related: [constraints, primary-foreign-keys, temporary-tables, indexes]
questions: [184, 185, 186, 187, 188, 189]
patterns: []
guides: []
minutes: 11
version: 1
---

## Introduction

Transferring stock or placing an order touches several rows and tables. Either all changes must happen or none. Transactions provide that guarantee and control what concurrent sessions see.

## Definition

A transaction is a sequence of statements executed as one unit. It satisfies ACID:
- **Atomicity**: all or nothing.
- **Consistency**: constraints hold before and after.
- **Isolation**: concurrent transactions do not see each other's partial work (to the degree of the isolation level).
- **Durability**: once committed, changes survive a crash (WAL in PostgreSQL).

## Why it matters

- Prevents half-applied business operations.
- Concurrency bugs (lost updates, double booking) are isolation problems.
- Interviewers ask about ACID, isolation levels, anomalies, deadlocks and MVCC.

## How it works

- `BEGIN` starts; `COMMIT` makes changes permanent; `ROLLBACK` discards them.
- Without `BEGIN`, PostgreSQL runs each statement in its own transaction (autocommit).
- `SAVEPOINT name` marks a point; `ROLLBACK TO SAVEPOINT name` undoes back to it without abandoning the transaction.
- In PostgreSQL, after an error the transaction is aborted: every further statement fails until `ROLLBACK` (or `ROLLBACK TO SAVEPOINT`).
- **MVCC**: an `UPDATE` writes a new row version; readers keep seeing the version valid for their snapshot. Readers do not block writers and writers do not block readers. Two writers on the same row do block each other.

## Syntax

```sql-syntax
BEGIN [ISOLATION LEVEL { READ COMMITTED | REPEATABLE READ | SERIALIZABLE }];
  ...statements...
  SAVEPOINT sp1;
  ...
  ROLLBACK TO SAVEPOINT sp1;
COMMIT;   -- or ROLLBACK;

SELECT ... FOR UPDATE [NOWAIT | SKIP LOCKED];
```

## Simple examples

Every runnable example on this site already runs inside `BEGIN ... ROLLBACK`, so changes are undone afterwards. Inside the block you see your own changes:

```sql
UPDATE products SET units_in_stock = units_in_stock - 5 WHERE product_id = 1;
SELECT product_id, product_name, units_in_stock FROM products WHERE product_id = 1;
```

## Intermediate examples

Atomic order creation with data-modifying CTEs (one statement, so it succeeds or fails as a whole):

```sql
WITH new_order AS (
  INSERT INTO orders (customer_id, employee_id, order_date, ship_via)
  VALUES ('ALFKI', 1, DATE '1998-12-31', 1)
  RETURNING order_id
), lines AS (
  INSERT INTO order_details (order_id, product_id, unit_price, quantity)
  SELECT n.order_id, p.product_id, p.unit_price, 2
  FROM new_order n CROSS JOIN products p
  WHERE p.product_id IN (1, 2)
  RETURNING order_id, product_id, quantity
)
SELECT * FROM lines;
```

Savepoint: undo part of the work, keep the rest.

```sql
UPDATE products SET unit_price = unit_price * 1.10 WHERE category_id = 1;
SAVEPOINT before_cat2;
UPDATE products SET unit_price = unit_price * 2 WHERE category_id = 2;
ROLLBACK TO SAVEPOINT before_cat2;
SELECT category_id, ROUND(AVG(unit_price), 2) AS avg_price
FROM products WHERE category_id IN (1, 2)
GROUP BY category_id ORDER BY category_id;
```

## Advanced examples

Lock rows you are about to change to prevent lost updates (`FOR UPDATE`). A second session running the same statement waits until you commit or roll back:

```sql
SELECT product_id, units_in_stock
FROM products
WHERE product_id = 1
FOR UPDATE;
```

Atomic check-and-update without an explicit lock: put the condition in the `UPDATE` itself.

```sql
UPDATE products
SET units_in_stock = units_in_stock - 10
WHERE product_id = 1 AND units_in_stock >= 10
RETURNING product_id, units_in_stock;
```

If no row comes back, there was not enough stock and nothing changed.

`TRUNCATE` is transactional in PostgreSQL (unlike MySQL or Oracle, where it implicitly commits):

```sql
CREATE TEMP TABLE t AS SELECT * FROM shippers;
SAVEPOINT s;
TRUNCATE t;
ROLLBACK TO SAVEPOINT s;
SELECT COUNT(*) AS rows_back FROM t;
```

## Real-world scenarios

- Order placement: insert order, insert lines, decrement stock.
- Money transfer: debit and credit in one transaction.
- Job queues: `SELECT ... FOR UPDATE SKIP LOCKED LIMIT 1` so workers do not grab the same job.
- Batch imports with savepoints to skip bad rows.

## PostgreSQL specifics

- Default isolation is **Read Committed**. Each statement sees data committed before it started.
- `READ UNCOMMITTED` is accepted but behaves as Read Committed: PostgreSQL never allows dirty reads.
- **Repeatable Read** in PostgreSQL is snapshot isolation: one snapshot for the whole transaction; it also prevents phantoms (stronger than the standard requires). Concurrent updates of the same row fail with a serialization error.
- **Serializable** uses SSI (serializable snapshot isolation) and may abort transactions with SQLSTATE `40001`; the application must retry.
- DDL is transactional: `CREATE TABLE`, `ALTER TABLE`, `TRUNCATE` can be rolled back. MySQL and Oracle commit implicitly on DDL.
- Old row versions are cleaned by `VACUUM`; long-running transactions prevent cleanup and cause bloat.
- Deadlocks are detected automatically (`deadlock_timeout`), and one transaction is aborted.

## Visual explanation

| Isolation level (standard) | Dirty read | Non-repeatable read | Phantom | PostgreSQL behaviour |
|---|---|---|---|---|
| Read Uncommitted | possible | possible | possible | same as Read Committed |
| Read Committed | no | possible | possible | default |
| Repeatable Read | no | no | possible | no phantoms (snapshot) |
| Serializable | no | no | no | SSI, may raise 40001 |

```text
MVCC, products row 1
T1: BEGIN; UPDATE stock=16  -> new version v2 (uncommitted)
T2: SELECT stock            -> still sees v1 = 21   (no blocking)
T1: COMMIT
T2: SELECT stock            -> Read Committed: 16 ; Repeatable Read: 21
```

## Common mistakes

- Read-modify-write in the application (`SELECT` then `UPDATE stock = :x`) without locks: lost updates.
- Leaving transactions open ("idle in transaction"): holds locks, blocks `VACUUM`.
- Not retrying on serialization failures under Serializable.
- Assuming `TRUNCATE` or DDL can be rolled back in every database.
- Taking locks in different orders in different code paths: deadlocks.

## Performance

- Keep transactions short; do no user interaction or network calls inside them.
- Batch many small inserts in one transaction to avoid per-commit fsync costs.
- Higher isolation means more retries/aborts under contention.
- `SKIP LOCKED` scales queue workers without blocking.

## Interview questions

### What does ACID stand for?

Atomicity, Consistency, Isolation, Durability: all-or-nothing, constraints preserved, controlled visibility between concurrent transactions, and committed data survives crashes.

### What is PostgreSQL's default isolation level and what can go wrong?

Read Committed. Each statement gets a fresh snapshot, so two reads in one transaction can differ (non-repeatable reads, phantoms), and naive read-then-write logic can lose updates.

### What is MVCC?

Multi-Version Concurrency Control: writers create new row versions instead of overwriting, so readers see a consistent snapshot without locking. Old versions are removed later by `VACUUM`.

### How do you prevent a lost update?

Use an atomic `UPDATE ... SET x = x - n WHERE ...`, lock with `SELECT ... FOR UPDATE`, use optimistic locking with a version column, or run under Repeatable Read/Serializable and retry.

### Can you roll back a TRUNCATE?

In PostgreSQL, yes, because DDL and `TRUNCATE` are transactional. In MySQL and Oracle it commits implicitly.

## Quick revision

- `BEGIN` / `COMMIT` / `ROLLBACK`, `SAVEPOINT` for partial undo.
- ACID; WAL gives durability.
- PostgreSQL default: Read Committed; no dirty reads at any level.
- Repeatable Read = snapshot; Serializable = SSI + retries.
- MVCC: readers and writers do not block each other.
- DDL and `TRUNCATE` are transactional in PostgreSQL.
- Error aborts the whole transaction until rollback.
