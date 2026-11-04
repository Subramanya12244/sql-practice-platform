---
title: SQL DDL and Constraints
slug: ddl-constraints
order: 16
level: Intermediate
description: Define tables with SQL DDL: CREATE TABLE, ALTER TABLE, data types, and PRIMARY KEY, FOREIGN KEY, UNIQUE, NOT NULL, CHECK and DEFAULT constraints.
related: [q35-categories-and-number-of-products, q42-products-and-suppliers]
---

Data Definition Language (DDL) creates and changes the structure of the database. Constraints are rules the database enforces on every write, so bad data never gets in.

| Constraint | Enforces |
|---|---|
| `PRIMARY KEY` | unique, not null row identity |
| `FOREIGN KEY ... REFERENCES` | value exists in parent table |
| `UNIQUE` | no duplicates |
| `NOT NULL` | value required |
| `CHECK (expr)` | custom rule |
| `DEFAULT v` | value used when omitted |

## Syntax

```sql
CREATE TABLE t (
    id      SERIAL PRIMARY KEY,
    name    VARCHAR(100) NOT NULL UNIQUE,
    price   NUMERIC(10,2) DEFAULT 0 CHECK (price >= 0),
    cat_id  INTEGER REFERENCES categories(category_id) ON DELETE SET NULL
);
ALTER TABLE t ADD COLUMN note TEXT;
ALTER TABLE t ADD CONSTRAINT ck CHECK (...);
ALTER TABLE t DROP COLUMN note;
DROP TABLE t;
```

## Examples

**A product reviews table tied to products:**

```sql
CREATE TABLE product_reviews (
    review_id  SERIAL PRIMARY KEY,
    product_id INTEGER NOT NULL REFERENCES products(product_id),
    rating     INTEGER NOT NULL CHECK (rating BETWEEN 1 AND 5),
    created_on DATE DEFAULT CURRENT_DATE
);
```

**Add a constraint to an existing table:**

```sql
ALTER TABLE products ADD CONSTRAINT products_price_nonneg CHECK (unit_price >= 0);
```

**Inspect the constraints of a table:**

```sql
SELECT conname, contype
FROM pg_constraint
WHERE conrelid = 'order_details'::regclass;
```

## Common mistakes

- Adding a `NOT NULL` or `CHECK` to a table whose existing rows violate it fails. Clean data first.
- Using `FLOAT`/`REAL` for money. Use `NUMERIC`.
- Forgetting an index on foreign key columns: PostgreSQL does not create one automatically.
- `DROP TABLE` is irreversible outside a transaction.

## Exercises

```exercise
prompt: Create a table promo_codes (code VARCHAR(20) PRIMARY KEY, percent_off INTEGER NOT NULL CHECK between 1 and 90), insert codes 'SPRING10' (10) and 'VIP25' (25), and return all rows.
orderBy: code
---
CREATE TABLE promo_codes (code VARCHAR(20) PRIMARY KEY, percent_off INTEGER NOT NULL CHECK (percent_off BETWEEN 1 AND 90)); INSERT INTO promo_codes VALUES ('SPRING10', 10), ('VIP25', 25); SELECT * FROM promo_codes ORDER BY code;
```

```exercise
prompt: Add a column loyalty_tier TEXT DEFAULT 'standard' to customers, then return the number of customers per loyalty_tier.
---
ALTER TABLE customers ADD COLUMN loyalty_tier TEXT DEFAULT 'standard'; SELECT loyalty_tier, COUNT(*) AS customers FROM customers GROUP BY loyalty_tier;
```

```exercise
prompt: List the name and type (contype) of every constraint on the order_details table.
---
SELECT conname, contype FROM pg_constraint WHERE conrelid = 'order_details'::regclass;
```
