---
slug: cross-join
title: SQL CROSS JOIN Explained with Examples
description: Learn SQL CROSS JOIN with Northwind examples: Cartesian products, building every combination, filling zero-sales gaps, row-count math, and common mistakes.
keywords: sql cross join, cartesian product, cross join example, all combinations sql, cross join vs inner join
questions: 71, 72, 73, 74, 75, 76, 77, 78
related: inner-join, left-join, self-join
---

A `CROSS JOIN` returns the Cartesian product of two tables: every row of the first paired with every row of the second. It has no join condition. If one table has 9 rows and the other 8, the result has 72 rows. It is used deliberately to generate every combination — for example every employee and every category — often as a scaffold for a report that must show zeros.

## Syntax

```sql
SELECT a.col, b.col
FROM table_a a
CROSS JOIN table_b b;

-- Equivalent older forms
SELECT ... FROM table_a a, table_b b;
SELECT ... FROM table_a a JOIN table_b b ON TRUE;
```

## Example

**Business question:** List every possible combination of employee and product category.

```sql
SELECT e.employee_id,
       e.first_name || ' ' || e.last_name AS employee,
       c.category_name
FROM employees e
CROSS JOIN categories c
ORDER BY e.employee_id, c.category_name;
```

Illustrative result:

| employee_id | employee | category_name |
|---|---|---|
| 1 | Nancy Davolio | Beverages |
| 1 | Nancy Davolio | Condiments |
| 1 | Nancy Davolio | Confections |
| … | … | … |

With 9 employees and 8 categories, expect 72 rows.

## How it works

No row is dropped and no matching happens: the row count is always `rows(A) × rows(B)`. That makes it easy to verify — if your result count is not the product, something else is filtering.

The most useful real-world pattern is a **scaffold plus left join**. A plain `GROUP BY` sales report only shows combinations that had sales. Cross join first to create every combination, then left join actual sales onto it so missing combinations show 0:

```sql
WITH combos AS (
    SELECT e.employee_id, c.category_id, c.category_name
    FROM employees e
    CROSS JOIN categories c
),
sales AS (
    SELECT o.employee_id, p.category_id,
           SUM(od.unit_price * od.quantity * (1 - od.discount)) AS revenue
    FROM orders o
    JOIN order_details od ON od.order_id  = o.order_id
    JOIN products p       ON p.product_id = od.product_id
    GROUP BY o.employee_id, p.category_id
)
SELECT cb.employee_id, cb.category_name,
       ROUND(COALESCE(s.revenue, 0)::numeric, 2) AS revenue
FROM combos cb
LEFT JOIN sales s
  ON s.employee_id = cb.employee_id
 AND s.category_id = cb.category_id
ORDER BY cb.employee_id, cb.category_name;
```

This is how you build complete matrices: every product by every shipper, every customer by every month, and so on.

## Common mistakes

- **Adding `ON` clauses and extra joins.** A recorded mistake on this site (Q71): the "every employee–category combination" question was answered by joining through `products`, `order_details`, and `orders`. That returns only combinations where the employee actually sold in that category — an inner-join chain, not a Cartesian product.
- **Accidental cross joins.** Forgetting a join condition, or listing tables with commas and no `WHERE`, creates a Cartesian product you did not intend. On large tables this can explode to millions of rows.
- **Cross joining big tables.** `customers × products` is already thousands of rows. Cross join small dimension tables, not fact tables like `order_details`.
- **Wrong name column.** "Supplier name" means `suppliers.company_name`, not `contact_name`. A recorded slip on the supplier combinations questions.
- **Missing `ORDER BY`.** Without it, combination order is not guaranteed, and graders that compare exact output will reject the answer.

## When to use it vs alternatives

| Need | Use |
|---|---|
| Every combination of two lists | `CROSS JOIN` |
| Only related combinations | `INNER JOIN ... ON` |
| All combinations with metrics, zeros included | `CROSS JOIN` scaffold + `LEFT JOIN` facts |
| Pairs from the same table | Self join with `t1.id < t2.id` |
| A series of dates or numbers | `generate_series()` (often cross joined) |

`CROSS JOIN` and `INNER JOIN ... ON TRUE` are the same thing; the explicit keyword signals intent to reviewers.

## Interview questions

### What is a CROSS JOIN?
A `CROSS JOIN` combines every row of one table with every row of another, producing a Cartesian product. It takes no `ON` condition. The result size is the product of the two tables' row counts.

### How many rows does a CROSS JOIN return?
Exactly `rows(A) × rows(B)`. For 9 employees and 8 categories that is 72 rows. If either table is empty, the result is empty.

### When is a CROSS JOIN actually useful?
When you need every combination, such as a product-by-shipper matrix, or a complete scaffold for a report that must show zero values. Cross join the dimensions, then left join the facts and wrap sums in `COALESCE(..., 0)`.

### What is the difference between CROSS JOIN and INNER JOIN?
`INNER JOIN` keeps only pairs that satisfy the `ON` condition. `CROSS JOIN` keeps all pairs. An inner join with an always-true condition behaves like a cross join.

## Practice

Practice this pattern with the questions below.
