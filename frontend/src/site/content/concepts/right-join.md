---
slug: right-join
title: SQL RIGHT JOIN Explained with Examples
description: Learn SQL RIGHT JOIN with Northwind examples: which table is preserved, chaining right joins correctly, RIGHT vs LEFT JOIN, and real interview mistakes.
keywords: sql right join, right outer join, right join vs left join, right join example, preserved table
questions: 41, 42, 43, 44, 45, 46, 47, 48, 49, 50
related: left-join, full-outer-join, inner-join
---

A `RIGHT JOIN` (or `RIGHT OUTER JOIN`) returns every row from the right table and the matching rows from the left table, filling left-side columns with NULL when there is no match. It is the mirror image of `LEFT JOIN`: `a RIGHT JOIN b` gives the same rows as `b LEFT JOIN a`. The key skill is knowing which table is preserved.

## Syntax

```sql
SELECT a.col, b.col
FROM table_a a
RIGHT JOIN table_b b
  ON a.b_id = b.id;     -- every row of table_b is kept
```

## Example

**Business question:** Show every supplier with the number of products they supply, including suppliers with none.

```sql
SELECT s.supplier_id,
       s.company_name,
       COUNT(p.product_id) AS product_count
FROM products p
RIGHT JOIN suppliers s ON p.supplier_id = s.supplier_id
GROUP BY s.supplier_id, s.company_name
ORDER BY product_count DESC, s.company_name;
```

Illustrative result:

| supplier_id | company_name | product_count |
|---|---|---|
| 18 | Aux joyeux ecclésiastiques | 3 |
| 16 | Bigfoot Breweries | 3 |
| 5 | Cooperativa de Quesos | 3 |

`suppliers` is on the right, so every supplier appears. `COUNT(p.product_id)` returns 0 for a supplier with no products; `COUNT(*)` would return 1.

## How it works

The join keeps all rows from whichever table is written **after** `RIGHT JOIN`. Swapping the two table names flips which side is preserved, so direction and table order together decide the result.

Chains are where right joins get tricky. Joins are evaluated left to right, and each `RIGHT JOIN` preserves the result of the table on its right — the newest table added. So in:

```sql
FROM customers c
RIGHT JOIN orders o         ON o.customer_id = c.customer_id
RIGHT JOIN order_details od ON od.order_id   = o.order_id
```

the final preserved table is `order_details`, not `customers`. Customers with no orders vanish, because they never reach `order_details`.

To keep all customers using right joins, the customer table must be the last right-hand table:

```sql
SELECT c.customer_id,
       c.company_name,
       COALESCE(ROUND(SUM(od.unit_price * od.quantity * (1 - od.discount))::numeric, 2), 0) AS revenue
FROM order_details od
RIGHT JOIN orders o    ON od.order_id   = o.order_id
RIGHT JOIN customers c ON o.customer_id = c.customer_id
GROUP BY c.customer_id, c.company_name
ORDER BY revenue DESC;
```

Read it as: lines are attached to orders (all orders kept), then orders are attached to customers (all customers kept).

## Common mistakes

- **Wrong chain direction.** A recorded mistake on this site (Q49): `customers RIGHT JOIN orders RIGHT JOIN order_details` preserved `order_details`, so no-order customers were dropped. The table you want to keep must be the last right-hand table, or rewrite the query with `LEFT JOIN` from that table.
- **Selecting an ungrouped column.** The same attempt selected `contact_name` without grouping it. Group by the primary key and include display columns, or aggregate them.
- **`WHERE` on the left table.** A filter such as `WHERE p.discontinued = false` removes the NULL rows for unmatched suppliers, turning the query into an inner join. Move it into `ON`.
- **`COUNT(*)` with an outer join.** It counts the NULL-padded row. Count a column from the optional side.
- **Mixing LEFT and RIGHT in one chain.** It is legal but hard to reason about. Pick one direction.

## When to use it vs alternatives

| Need | Prefer |
|---|---|
| Keep all rows of one table | `LEFT JOIN` with that table first (most readable) |
| Same, but the preserved table is already last in a long query | `RIGHT JOIN` |
| Keep unmatched rows from both sides | `FULL OUTER JOIN` |
| Keep only matches | `INNER JOIN` |

Many teams avoid `RIGHT JOIN` and always write `LEFT JOIN` with the preserved table first, because readers expect the "main" table in `FROM`. Every right join can be rewritten as a left join by swapping table order. Interviewers still ask about it to test that you understand which side is preserved.

## Interview questions

### What is the difference between LEFT JOIN and RIGHT JOIN?
`LEFT JOIN` keeps all rows from the table before the keyword; `RIGHT JOIN` keeps all rows from the table after it. The results are equivalent when the tables are swapped: `a RIGHT JOIN b` equals `b LEFT JOIN a`, apart from column order.

### Which table is preserved in a chain of RIGHT JOINs?
The table on the right of the last `RIGHT JOIN`. Joins are evaluated left to right, so each right join preserves the newly added table. Earlier tables can lose rows if they do not match.

### Why would anyone use RIGHT JOIN instead of LEFT JOIN?
Mostly convenience: when adding a table to the end of an existing query and that new table must be fully preserved. Functionally, any `RIGHT JOIN` can be rewritten as a `LEFT JOIN`, which most style guides prefer.

### How do you count related rows correctly with a RIGHT JOIN?
Use `COUNT` on a non-null column from the left (optional) table, such as `COUNT(p.product_id)`. Unmatched rows have NULL there, so they count as 0. `COUNT(*)` would count them as 1.

## Practice

Practice this pattern with the questions below.
