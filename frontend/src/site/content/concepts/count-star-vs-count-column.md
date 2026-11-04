---
slug: count-star-vs-count-column
title: SQL COUNT(*) vs COUNT(column) vs COUNT(DISTINCT)
description: COUNT(*) vs COUNT(column) in SQL explained with Northwind examples: NULL handling, outer joins showing zero, COUNT DISTINCT, and the interview traps to avoid.
keywords: count star vs count column, sql count, count distinct, count with left join, count null sql
questions: 5, 9, 12, 25, 33, 35, 36, 38, 62
related: aggregate-functions, left-join, null-handling-coalesce
---

`COUNT(*)` counts rows. `COUNT(column)` counts rows where that column is not NULL. `COUNT(DISTINCT column)` counts unique non-NULL values. The difference looks small, but it decides whether a customer with no orders shows 0 or 1, and whether a fan-out join counts orders or order lines.

## Syntax

```sql
SELECT COUNT(*)                 AS all_rows,
       COUNT(col)               AS non_null_values,
       COUNT(DISTINCT col)      AS unique_values,
       COUNT(*) FILTER (WHERE condition) AS conditional_rows
FROM some_table;
```

## Example

**Business question:** For each shipper, how many orders have they handled? Include shippers with none.

```sql
SELECT s.shipper_id,
       s.company_name,
       COUNT(*)          AS count_star,
       COUNT(o.order_id) AS orders_handled
FROM shippers s
LEFT JOIN orders o ON o.ship_via = s.shipper_id
GROUP BY s.shipper_id, s.company_name
ORDER BY orders_handled DESC;
```

Illustrative result (assume a fourth shipper with no orders):

| shipper_id | company_name | count_star | orders_handled |
|---|---|---|---|
| 2 | United Package | 326 | 326 |
| 3 | Federal Shipping | 255 | 255 |
| 1 | Speedy Express | 249 | 249 |
| 4 | New Courier | 1 | 0 |

The shipper with no orders still produces one row from the `LEFT JOIN`, with `o.order_id` NULL. `COUNT(*)` counts that row (1); `COUNT(o.order_id)` skips the NULL (0). Only the second is correct.

## How it works

| Expression | Counts | NULLs |
|---|---|---|
| `COUNT(*)` | Rows | Included |
| `COUNT(1)` | Rows (same as `COUNT(*)`) | Included |
| `COUNT(col)` | Non-NULL values | Excluded |
| `COUNT(DISTINCT col)` | Unique non-NULL values | Excluded |

`COUNT` never returns NULL; an empty input gives 0. That is why it does not need `COALESCE`, unlike `SUM`.

**Fan-out.** After `orders JOIN order_details`, each row is a line item. `COUNT(*)` and `COUNT(o.order_id)` both count lines; only `COUNT(DISTINCT o.order_id)` counts orders:

```sql
SELECT o.customer_id,
       COUNT(*)                   AS order_lines,
       COUNT(DISTINCT o.order_id) AS orders,
       COUNT(DISTINCT od.product_id) AS distinct_products
FROM orders o
JOIN order_details od ON od.order_id = o.order_id
GROUP BY o.customer_id
ORDER BY orders DESC
LIMIT 5;
```

**Counting a nullable column on purpose.** `COUNT(shipped_date)` counts shipped orders, because unshipped orders have NULL there:

```sql
SELECT COUNT(*) AS total_orders,
       COUNT(shipped_date) AS shipped_orders,
       COUNT(*) - COUNT(shipped_date) AS unshipped_orders
FROM orders;
```

## Common mistakes

- **`COUNT(*)` over an outer join.** Entities with no matches show 1 instead of 0. Count a non-null column from the optional side, ideally its primary key.
- **Counting a foreign key instead of the entity.** A recorded lesson on this site (Q62): `COUNT(e.reports_to)` gave the right number but expressed the wrong intent; `COUNT(e.employee_id)` counts the employees themselves. Count the key of the thing you are counting.
- **Counting a nullable column by accident.** `COUNT(region)` on `customers` skips customers with no region, so it understates the total. Use `COUNT(*)` or the primary key.
- **Missing `DISTINCT` after fan-out.** Order counts inflate once `order_details` is joined.
- **Using `DISTINCT` everywhere "just in case".** `COUNT(DISTINCT o.order_id)` is unnecessary without fan-out and can hide a join bug. Know your grain.
- **Believing `COUNT(1)` is faster.** In PostgreSQL `COUNT(*)` is the optimized form; `COUNT(1)` is equivalent at best.

## When to use it vs alternatives

| Question | Use |
|---|---|
| How many rows / orders in this table? | `COUNT(*)` |
| How many related rows, zero included, over a LEFT JOIN? | `COUNT(right.pk)` |
| How many have a value filled in? | `COUNT(col)` |
| How many different X? | `COUNT(DISTINCT x)` |
| How many rows meet a condition? | `COUNT(*) FILTER (WHERE ...)` or `SUM(CASE WHEN ... THEN 1 ELSE 0 END)` |
| Does any row exist? | `EXISTS` (stops at first match) |

## Interview questions

### What is the difference between COUNT(*) and COUNT(column)?
`COUNT(*)` counts every row, including rows where all values are NULL. `COUNT(column)` counts only rows where that column is not NULL. With a `LEFT JOIN`, this decides whether unmatched entities show 0 or 1.

### Is COUNT(1) faster than COUNT(*)?
No. Both count rows and return the same result. In PostgreSQL `COUNT(*)` is the specially optimized form, so `COUNT(1)` is no faster and may be marginally slower.

### Can COUNT return NULL?
No. `COUNT` returns 0 when there are no rows or no non-NULL values. Other aggregates like `SUM` and `AVG` return NULL in that case, which is why they often need `COALESCE`.

### When should you use COUNT(DISTINCT)?
When you need breadth, such as the number of unique customers an employee served, or when a join fans out and duplicates the entity you are counting. Without fan-out, plain `COUNT` on the primary key is enough.

## Practice

Practice this pattern with the questions below.
