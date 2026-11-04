---
slug: inner-join
title: SQL INNER JOIN Explained with Examples
description: Learn SQL INNER JOIN with Northwind examples: how matching rows are kept, multi-table joins, fan-out, INNER vs LEFT JOIN, and common interview mistakes.
keywords: sql inner join, inner join example, join multiple tables, inner join vs left join, sql join
questions: 1, 2, 3, 4, 9, 10, 11, 12, 14
related: left-join, self-join, aggregate-functions
---

An `INNER JOIN` combines rows from two tables where the join condition is true and discards every row that has no match on the other side. It is the default join: writing `JOIN` alone means `INNER JOIN`. Most revenue and reporting queries chain several inner joins to walk from one table to another through foreign keys.

## Syntax

```sql
SELECT a.col, b.col
FROM table_a a
[INNER] JOIN table_b b
  ON b.a_id = a.id;

-- Chain through bridge tables
SELECT ...
FROM a
JOIN b ON b.a_id = a.id
JOIN c ON c.b_id = b.id;
```

## Example

**Business question:** What is net revenue by shipper?

`orders.ship_via` is the foreign key to `shippers.shipper_id` — the names differ, which is common in real schemas.

```sql
SELECT s.company_name AS shipper,
       COUNT(DISTINCT o.order_id) AS orders,
       ROUND(SUM(od.unit_price * od.quantity * (1 - od.discount))::numeric, 2) AS revenue
FROM shippers s
JOIN orders o         ON o.ship_via  = s.shipper_id
JOIN order_details od ON od.order_id = o.order_id
GROUP BY s.shipper_id, s.company_name
ORDER BY revenue DESC;
```

Illustrative result:

| shipper | orders | revenue |
|---|---|---|
| United Package | 326 | 533547.63 |
| Federal Shipping | 255 | 383405.47 |
| Speedy Express | 249 | 348839.94 |

## How it works

Conceptually, the database pairs each row of the left table with each row of the right table and keeps only pairs where `ON` is true. Consequences:

- **Unmatched rows disappear from both sides.** A customer with no orders is not in `customers JOIN orders`. An order with a NULL `customer_id` is not either, because `NULL = anything` is never true.
- **One-to-many joins multiply rows.** Each order appears once per line in `order_details`. This "fan-out" is why `COUNT(DISTINCT o.order_id)` is used above.
- **Table order does not change the result** for inner joins; `a JOIN b` equals `b JOIN a`. The planner picks the physical order.
- **Bridge tables.** `categories` and `customers` share no key. To count which categories a customer bought from, route through `orders → order_details → products`:

```sql
SELECT c.company_name,
       COUNT(DISTINCT p.category_id) AS categories_bought
FROM customers c
JOIN orders o         ON o.customer_id = c.customer_id
JOIN order_details od ON od.order_id   = o.order_id
JOIN products p       ON p.product_id  = od.product_id
GROUP BY c.customer_id, c.company_name
ORDER BY categories_bought DESC
LIMIT 10;
```

`ON` conditions do not have to be equality. A join on `>` or `BETWEEN` (a non-equi join) is valid, for example joining each employee to employees with higher revenue.

## Common mistakes

- **Dropping zero-activity rows without noticing.** An inner join to `orders` silently removes employees or customers with no orders. If the question says "all customers", use `LEFT JOIN`.
- **Counting after fan-out.** `COUNT(*)` after joining `order_details` counts line items. Use `COUNT(DISTINCT o.order_id)` for orders.
- **Joining on the wrong column.** `orders.ship_via = shippers.shipper_id` is right; there is no `orders.shipper_id`. Check the schema for differently named foreign keys.
- **Ambiguous columns.** `customer_id` exists in both `customers` and `orders`. Qualify every column with an alias.
- **Using the wrong name column.** `suppliers.contact_name` is a person; `suppliers.company_name` is the supplier. A recorded mistake on this site was returning the contact when "supplier name" was asked.
- **Putting join conditions in `WHERE` with comma joins.** `FROM a, b WHERE ...` works but forgetting a condition creates a Cartesian product. Prefer explicit `JOIN ... ON`.

## When to use it vs alternatives

| Join | Keeps |
|---|---|
| `INNER JOIN` | Only matching rows |
| `LEFT JOIN` | All left rows + matches (NULLs if none) |
| `RIGHT JOIN` | All right rows + matches |
| `FULL OUTER JOIN` | All rows from both sides |
| `EXISTS` | Left rows with a match, no duplication |

If you only need to filter (for example, customers who ordered in 1998) and do not need columns from the other table, `EXISTS` avoids fan-out duplicates entirely.

## Interview questions

### What is the difference between INNER JOIN and LEFT JOIN?
`INNER JOIN` returns only rows that match in both tables. `LEFT JOIN` returns every row from the left table and fills the right table's columns with NULL when there is no match. Use `LEFT JOIN` when the question requires all entities, including those with zero activity.

### Is JOIN the same as INNER JOIN?
Yes. In PostgreSQL and standard SQL, `JOIN` without a qualifier is an inner join. Writing `INNER` is optional but some teams prefer it for clarity.

### Why did my row count increase after a join?
The join is one-to-many, so each row on the "one" side repeats once per matching row on the "many" side. That is expected, but aggregates must account for it, for example with `COUNT(DISTINCT key)` or by aggregating before joining.

### Does the order of tables matter in an INNER JOIN?
Not for the result. Inner joins are commutative and associative, so the planner can reorder them. Order does matter for outer joins.

## Practice

Practice this pattern with the questions below.
