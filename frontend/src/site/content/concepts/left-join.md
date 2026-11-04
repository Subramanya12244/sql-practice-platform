---
slug: left-join
title: SQL LEFT JOIN Explained with Examples
description: Learn SQL LEFT JOIN with Northwind examples: keep all left rows, find unmatched rows with an anti join, avoid WHERE-clause traps, and compare to INNER JOIN.
keywords: sql left join, left outer join, left join vs inner join, anti join, left join where is null
questions: 25, 26, 28, 29, 31, 33, 35, 37, 39, 40
related: inner-join, right-join, null-handling-coalesce
---

A `LEFT JOIN` (also called `LEFT OUTER JOIN`) returns every row from the left table, plus matching rows from the right table. When a left row has no match, the right table's columns come back as NULL instead of the row being dropped. Use it whenever the question says "all customers", "including those with none", or "never ordered".

## Syntax

```sql
SELECT a.col, b.col
FROM table_a a
LEFT JOIN table_b b
  ON b.a_id = a.id;

-- Anti join: left rows with no match
SELECT a.*
FROM table_a a
LEFT JOIN table_b b ON b.a_id = a.id
WHERE b.a_id IS NULL;
```

## Example

**Business question:** List every customer with their number of orders, including customers who have never ordered.

```sql
SELECT c.customer_id,
       c.company_name,
       COUNT(o.order_id) AS order_count
FROM customers c
LEFT JOIN orders o ON o.customer_id = c.customer_id
GROUP BY c.customer_id, c.company_name
ORDER BY order_count ASC, c.customer_id;
```

Illustrative result:

| customer_id | company_name | order_count |
|---|---|---|
| FISSA | FISSA Fabrica Inter. Salchichas | 0 |
| PARIS | Paris spécialités | 0 |
| BOTTM | Bottom-Dollar Markets | 1 |

`COUNT(o.order_id)` is essential here. `COUNT(*)` would return 1 for customers with no orders, because the unmatched row still exists — it just has NULLs on the right side.

## How it works

1. Every left row is kept at least once.
2. If a left row matches several right rows, it repeats once per match (fan-out).
3. If it matches none, it appears once with NULL in every right-side column.

That NULL is what powers the **anti join**: filter `WHERE right_key IS NULL` to find left rows that had no match.

```sql
-- Products that have never been ordered
SELECT p.product_id, p.product_name
FROM products p
LEFT JOIN order_details od ON od.product_id = p.product_id
WHERE od.product_id IS NULL;
```

Test a column that cannot be NULL in a real match — the join key or a primary key — so a NULL means "no match", not "match with a missing value".

**Chained left joins.** Revenue per customer needs `customers → orders → order_details`. Every link must stay `LEFT`; switching the second to `INNER` removes customers without orders again:

```sql
SELECT c.customer_id,
       COALESCE(ROUND(SUM(od.unit_price * od.quantity * (1 - od.discount))::numeric, 2), 0) AS revenue
FROM customers c
LEFT JOIN orders o         ON o.customer_id = c.customer_id
LEFT JOIN order_details od ON od.order_id   = o.order_id
GROUP BY c.customer_id
ORDER BY revenue;
```

`SUM` over only NULLs is NULL, so `COALESCE(..., 0)` turns "no orders" into 0.

## Common mistakes

- **Filtering the right table in `WHERE`.** `LEFT JOIN orders o ... WHERE o.order_date >= '1998-01-01'` removes all NULL rows and turns the query into an inner join. Move the condition into `ON`: `LEFT JOIN orders o ON o.customer_id = c.customer_id AND o.order_date >= DATE '1998-01-01'`.
- **`COUNT(*)` instead of `COUNT(right_col)`.** Customers with zero orders get counted as 1.
- **Breaking the chain.** A later `INNER JOIN` on a right-side table drops the unmatched left rows. Keep every downstream link `LEFT`.
- **Forgetting `COALESCE` on `SUM`.** Zero-order customers show NULL revenue, which sorts and displays oddly.
- **NULL sort position.** In PostgreSQL, NULLs sort last in `ASC` and first in `DESC`. Sorting `MAX(o.order_date) DESC` puts never-ordered customers on top unless you add `NULLS LAST`.
- **Concatenating names across a left join.** `e.first_name || ' ' || e.last_name` returns NULL for missing employees, but `CONCAT(...)` returns `' '`. Pick based on whether NULL is the required output.

## When to use it vs alternatives

For "rows in A with no match in B", there are three idioms:

| Pattern | NULL-safe | Notes |
|---|---|---|
| `LEFT JOIN ... WHERE b.key IS NULL` | Yes | Easy to extend with right-side columns |
| `NOT EXISTS (SELECT 1 FROM b WHERE b.key = a.key)` | Yes | Clearest intent; planner treats it as an anti join |
| `NOT IN (SELECT b.key FROM b)` | **No** | Returns zero rows if any `b.key` is NULL |

```sql
SELECT c.customer_id, c.company_name
FROM customers c
WHERE NOT EXISTS (SELECT 1 FROM orders o WHERE o.customer_id = c.customer_id);
```

Use `INNER JOIN` when unmatched rows should be excluded, and `FULL OUTER JOIN` when unmatched rows from both sides matter.

## Interview questions

### What is the difference between LEFT JOIN and INNER JOIN?
`INNER JOIN` keeps only rows with a match in both tables. `LEFT JOIN` keeps every row of the left table and fills right-side columns with NULL when nothing matches. Row counts from a `LEFT JOIN` are always at least the left table's row count.

### How do you find customers who have never placed an order?
Left join `customers` to `orders` and keep rows where `o.order_id IS NULL`, or use `WHERE NOT EXISTS` with a correlated subquery on `orders`. Avoid `NOT IN` if the subquery column can be NULL.

### Why does a WHERE condition turn my LEFT JOIN into an INNER JOIN?
Unmatched rows have NULL in the right table's columns, and any comparison with NULL is not true, so `WHERE` removes them. Put conditions on the right table inside the `ON` clause to filter matches while keeping all left rows.

### Is LEFT JOIN the same as LEFT OUTER JOIN?
Yes. `OUTER` is optional; both keywords produce identical results in PostgreSQL and standard SQL.

## Practice

Practice this pattern with the questions below.
