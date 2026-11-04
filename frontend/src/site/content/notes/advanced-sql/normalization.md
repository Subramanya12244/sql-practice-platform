---
title: Normalization
slug: normalization
category: advanced-sql
difficulty: Advanced
description: 1NF, 2NF, 3NF and BCNF explained with Northwind, plus update anomalies, functional dependencies and when to denormalize.
prerequisites: [primary-foreign-keys, inner-join]
related: [database-design, primary-foreign-keys, constraints, jsonb, views]
questions: [2, 10, 125, 141]
patterns: [find-duplicates]
guides: []
minutes: 10
version: 1
---

## Introduction

If a customer's city is stored on every order, changing it means updating hundreds of rows, and missing one leaves the data contradicting itself. Normalization organises tables so each fact is stored once.

## Definition

Normalization is decomposing tables to remove redundancy and update anomalies, guided by **functional dependencies** (A -> B: a value of A determines exactly one value of B).

- **1NF**: atomic values, no repeating groups, each row identifiable by a key.
- **2NF**: 1NF, and no non-key column depends on only *part* of a composite key.
- **3NF**: 2NF, and no non-key column depends on another non-key column (no transitive dependency).
- **BCNF**: for every non-trivial dependency A -> B, A is a superkey.

## Why it matters

- Prevents insert, update and delete anomalies.
- Smaller, consistent tables; constraints become simple.
- Interviewers ask you to normalise a flat table and explain each normal form.

## How it works

1. List the attributes and the dependencies between them.
2. Pick the key.
3. Split out repeating groups (1NF), partial dependencies (2NF), transitive dependencies (3NF).
4. Link the pieces with foreign keys. Joins reassemble the original view.

## Syntax

```sql-syntax
-- Unnormalised
orders_flat(order_id, customer_name, customer_city, product_names_csv, ...)

-- 3NF decomposition
customers(customer_id PK, company_name, city, country)
orders(order_id PK, customer_id FK, order_date)
products(product_id PK, product_name, category_id FK, unit_price)
order_details(order_id FK, product_id FK, quantity, unit_price, PRIMARY KEY (order_id, product_id))
```

## Simple examples

Denormalised view of Northwind (what a spreadsheet would look like): customer and product data repeat on every line.

```sql
SELECT o.order_id, c.company_name, c.city, p.product_name, cat.category_name, od.quantity
FROM orders o
JOIN customers c   ON c.customer_id = o.customer_id
JOIN order_details od ON od.order_id = o.order_id
JOIN products p    ON p.product_id = od.product_id
JOIN categories cat ON cat.category_id = p.category_id
ORDER BY o.order_id
LIMIT 8;
```

Measure the redundancy: how many times each customer's city would be repeated in that flat layout.

```sql
SELECT c.customer_id, c.city, COUNT(*) AS copies_in_flat_table
FROM customers c
JOIN orders o ON o.customer_id = c.customer_id
JOIN order_details od ON od.order_id = o.order_id
GROUP BY c.customer_id, c.city
ORDER BY copies_in_flat_table DESC
LIMIT 5;
```

## Intermediate examples

1NF violation: a comma-separated list. Building it is fine for display, storing it is not:

```sql
SELECT o.order_id,
       STRING_AGG(p.product_name, ', ' ORDER BY p.product_name) AS products_csv
FROM orders o
JOIN order_details od ON od.order_id = o.order_id
JOIN products p ON p.product_id = od.product_id
GROUP BY o.order_id
ORDER BY o.order_id
LIMIT 5;
```

Querying "orders containing Chai" against such a column needs `LIKE '%Chai%'` and breaks on similar names. The normalised `order_details` table answers it with an exact join.

Verify a functional dependency (product_id -> category_id) holds: no product maps to two categories.

```sql
SELECT product_id, COUNT(DISTINCT category_id) AS categories
FROM products
GROUP BY product_id
HAVING COUNT(DISTINCT category_id) <= 1
ORDER BY product_id
LIMIT 5;
```

## Advanced examples

Decompose a flat staging table to 3NF inside one transaction:

```sql
CREATE TEMP TABLE flat AS
SELECT o.order_id, o.order_date, c.customer_id, c.company_name, c.city, c.country,
       od.product_id, p.product_name, od.quantity, od.unit_price
FROM orders o
JOIN customers c ON c.customer_id = o.customer_id
JOIN order_details od ON od.order_id = o.order_id
JOIN products p ON p.product_id = od.product_id;

CREATE TEMP TABLE n_customers AS SELECT DISTINCT customer_id, company_name, city, country FROM flat;
CREATE TEMP TABLE n_orders    AS SELECT DISTINCT order_id, order_date, customer_id FROM flat;
CREATE TEMP TABLE n_lines     AS SELECT order_id, product_id, quantity, unit_price FROM flat;

SELECT 'flat' AS tbl, COUNT(*) FROM flat
UNION ALL SELECT 'n_customers', COUNT(*) FROM n_customers
UNION ALL SELECT 'n_orders', COUNT(*) FROM n_orders
UNION ALL SELECT 'n_lines', COUNT(*) FROM n_lines;
```

Note that `order_details.unit_price` is not a 2NF violation: it is the price *at the time of the order*, a fact about the line, not a copy of `products.unit_price`.

## Real-world scenarios

- OLTP systems (orders, payments, inventory): normalise to 3NF.
- Analytics warehouses: deliberately denormalise into star schemas (fact + dimension tables) for fast reads.
- Caching derived values (order totals) with triggers or materialized views when reads dominate.
- JSONB for truly variable attributes, while keeping core fields relational.

## PostgreSQL specifics

- Normal forms are database-independent theory; nothing here is PostgreSQL-specific.
- PostgreSQL arrays and `jsonb` let you break 1NF on purpose. Use them for data you read as a whole, not data you join or constrain.
- Materialized views and generated columns (`GENERATED ALWAYS AS (...) STORED`) are controlled ways to denormalise.

## Visual explanation

```text
UNF   order(order_id, customer, city, "Chai, Chang, Tofu")      repeating group
 |  split list into rows
1NF   order_line(order_id, product, customer, city, qty)        key (order_id, product)
 |  customer/city depend only on order_id  (partial dependency)
2NF   orders(order_id, customer, city)  order_line(order_id, product, qty)
 |  city depends on customer, not on order_id  (transitive)
3NF   customers(customer, city)  orders(order_id, customer)  order_line(order_id, product, qty)
```

| Anomaly | Flat table symptom | Fixed by |
|---|---|---|
| Update | city changed in some rows only | storing city once (3NF) |
| Insert | cannot add a customer with no order | separate customers table |
| Delete | deleting last order loses the customer | separate customers table |

## Common mistakes

- Comma-separated IDs in a column ("tags = '1,4,7'").
- Over-normalising lookups that never change into many tiny joins.
- Treating historical snapshot values (price at order time) as redundancy.
- Denormalising before measuring a real performance problem.
- Forgetting constraints after splitting, so the pieces drift apart.

## Performance

- Normalised: cheap writes, more joins on reads. With indexed keys, joins are fast.
- Denormalised: fast reads, expensive and risky writes.
- Pick per workload: OLTP leans normalised, OLAP leans denormalised.

## Interview questions

### Explain 1NF, 2NF and 3NF in one line each.

1NF: atomic values, no repeating groups. 2NF: no non-key attribute depends on part of a composite key. 3NF: no non-key attribute depends on another non-key attribute.

### What is a transitive dependency?

A -> B and B -> C, so A -> C indirectly. Example: order_id -> customer_id -> city. Fix by moving city to the customers table.

### When would you denormalize?

For read-heavy analytics, reporting tables or caches where join cost matters more than write simplicity, ideally via materialized views or ETL so a normalised source of truth remains.

### Is storing unit_price in order_details redundant?

No. It records the price at sale time. `products.unit_price` is the current price; they are different facts.

### 3NF vs BCNF?

BCNF is stricter: every determinant must be a superkey. 3NF allows a dependency into a key attribute from a non-superkey. Most 3NF schemas are already BCNF.

## Quick revision

- Goal: each fact stored once.
- 1NF atomic; 2NF no partial dependency; 3NF no transitive dependency.
- BCNF: every determinant is a superkey.
- Anomalies: update, insert, delete.
- Denormalize deliberately for reads, keep a normalised source.
- Historical values are not redundancy.
