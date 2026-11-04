---
title: SQL INSERT, UPDATE, DELETE and UPSERT
slug: modifying-data
order: 15
level: Intermediate
description: Change data with SQL INSERT, UPDATE, DELETE, PostgreSQL UPSERT (ON CONFLICT) and RETURNING, with safe Northwind examples run inside transactions.
related: [q29-products-never-ordered, q114-unshipped-orders-older-than-30-days]
---

Data-modifying statements change rows. In PostgreSQL every one of them can end with `RETURNING`, which hands back the affected rows as a result set. Exercises here run inside a transaction that is rolled back, so nothing is saved.

## Syntax

```sql
INSERT INTO t (col1, col2) VALUES (v1, v2), (v3, v4) RETURNING *;
INSERT INTO t (cols) SELECT ... ;
UPDATE t SET col = expr WHERE condition RETURNING *;
DELETE FROM t WHERE condition RETURNING *;
INSERT INTO t (...) VALUES (...)
ON CONFLICT (key) DO UPDATE SET col = EXCLUDED.col;   -- upsert
ON CONFLICT (key) DO NOTHING;
```

DML can also live inside a CTE: `WITH u AS (UPDATE ... RETURNING *) SELECT ... FROM u;`

## Examples

**Insert a shipper and get its generated id:**

```sql
INSERT INTO shippers (company_name, phone)
VALUES ('Speedy Freight', '(503) 555-0199')
RETURNING shipper_id, company_name;
```

**Raise Beverages prices by 10%:**

```sql
UPDATE products
SET unit_price = ROUND(unit_price * 1.10, 2)
WHERE category_id = (SELECT category_id FROM categories WHERE category_name = 'Beverages')
RETURNING product_name, unit_price;
```

**Upsert a category by id:**

```sql
INSERT INTO categories (category_id, category_name, description)
VALUES (1, 'Beverages', 'Drinks of all kinds')
ON CONFLICT (category_id) DO UPDATE SET description = EXCLUDED.description
RETURNING *;
```

## Common mistakes

- `UPDATE` or `DELETE` without `WHERE` hits every row. Run the `WHERE` as a `SELECT` first.
- Deleting a parent row referenced by foreign keys fails (e.g. a customer with orders). Delete children first or use `ON DELETE CASCADE` deliberately.
- Inserting explicit ids into a `SERIAL` column does not advance its sequence; later inserts may collide.
- `ON CONFLICT` needs a unique index or constraint on the target columns.

## Exercises

```exercise
prompt: Insert a new shipper 'Northwind Express' with phone '(555) 010-0000' and return its company_name and phone.
---
INSERT INTO shippers (company_name, phone) VALUES ('Northwind Express', '(555) 010-0000') RETURNING company_name, phone;
```

```exercise
prompt: Increase unit_price by 5% (rounded to 2 decimals) for all products in category_id 1 and return product_id, product_name and the new unit_price.
orderBy: product_id
---
WITH u AS (UPDATE products SET unit_price = ROUND(unit_price * 1.05, 2) WHERE category_id = 1 RETURNING product_id, product_name, unit_price) SELECT * FROM u ORDER BY product_id;
```

```exercise
prompt: Delete all order lines (order_details) with quantity under 5 and return how many were deleted in a column deleted.
---
WITH d AS (DELETE FROM order_details WHERE quantity < 5 RETURNING *) SELECT COUNT(*) AS deleted FROM d;
```

```exercise
prompt: Upsert shipper_id 1 with company_name 'Speedy Express Ltd' using ON CONFLICT on shipper_id and return shipper_id and company_name.
---
INSERT INTO shippers (shipper_id, company_name, phone) VALUES (1, 'Speedy Express Ltd', '(503) 555-9831') ON CONFLICT (shipper_id) DO UPDATE SET company_name = EXCLUDED.company_name RETURNING shipper_id, company_name;
```
