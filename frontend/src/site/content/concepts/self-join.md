---
slug: self-join
title: SQL Self Join Explained with Examples
description: Learn SQL self joins with Northwind examples: employee-manager hierarchies, finding pairs with t1.id < t2.id, avoiding Cartesian products, and interview tips.
keywords: sql self join, self join example, employee manager sql, find pairs sql, self join hierarchy
questions: 61, 62, 63, 64, 65, 66, 67, 68, 69, 70
related: inner-join, left-join, cross-join
---

A self join joins a table to itself, using two different aliases so each copy can play a different role. It answers two families of questions: hierarchies stored in one table (an employee and their manager) and pairs of rows that share a value (two customers in the same city). There is no `SELF JOIN` keyword — it is an ordinary `INNER` or `LEFT JOIN` where both sides are the same table.

## Syntax

```sql
-- Hierarchy
SELECT child.col, parent.col
FROM t AS child
LEFT JOIN t AS parent ON parent.id = child.parent_id;

-- Pairs sharing a value (each pair once)
SELECT t1.id, t2.id
FROM t AS t1
JOIN t AS t2
  ON t1.shared_col = t2.shared_col
 AND t1.id < t2.id;
```

## Example

**Business question:** List each employee with the name of the manager they report to.

`employees.reports_to` holds the `employee_id` of the manager.

```sql
SELECT e.employee_id,
       e.first_name || ' ' || e.last_name AS employee,
       m.first_name || ' ' || m.last_name AS manager
FROM employees e
LEFT JOIN employees m ON m.employee_id = e.reports_to
ORDER BY e.employee_id;
```

Illustrative result:

| employee_id | employee | manager |
|---|---|---|
| 1 | Nancy Davolio | Andrew Fuller |
| 2 | Andrew Fuller | *NULL* |
| 3 | Janet Leverling | Andrew Fuller |
| 6 | Michael Suyama | Steven Buchanan |

`LEFT JOIN` keeps the top manager, whose `reports_to` is NULL. With `INNER JOIN` that person would disappear.

## How it works

The two aliases act like two separate tables with the same columns. The `ON` clause defines the relationship between a row in `e` and a row in `m`.

**Hierarchy direction.** `m.employee_id = e.reports_to` means "find the row whose id is my manager's id". Reversing it to `m.reports_to = e.employee_id` returns each employee's direct reports instead.

**Pair pattern.** To find products from the same supplier:

```sql
SELECT p1.supplier_id,
       p1.product_name AS product_a,
       p2.product_name AS product_b
FROM products p1
JOIN products p2
  ON p1.supplier_id = p2.supplier_id
 AND p1.product_id  < p2.product_id
ORDER BY p1.supplier_id, product_a, product_b;
```

- `p1.supplier_id = p2.supplier_id` restricts pairs to the same supplier.
- `p1.product_id < p2.product_id` removes self-pairs (A, A) and mirrored duplicates (B, A). Using `<>` instead keeps both (A, B) and (B, A), doubling the result.

**Managers only** (employees who have at least one report):

```sql
SELECT DISTINCT m.employee_id, m.first_name, m.last_name
FROM employees e
JOIN employees m ON m.employee_id = e.reports_to;
```

## Common mistakes

- **Missing the equality condition.** A recorded mistake on this site (Q68, Q69): writing only `p1.product_id < p2.product_id` without `p1.supplier_id = p2.supplier_id` paired every product with every later product — a near-Cartesian product. Both conditions are required.
- **Joining on the wrong column for the hierarchy.** Another recorded slip: joining the manager alias on `e1.employee_id` instead of `e1.reports_to`, which walked the hierarchy in the wrong direction.
- **Using `<>` instead of `<`.** Each pair appears twice.
- **Copy-paste column errors.** Changing the join to `city` but still selecting `country` (a recorded slip on the same-city question) gives a plausible-looking but wrong report. Check that `SELECT` matches the question.
- **Extra joins.** Joining the table a third time just to read a column already available on an existing alias adds cost and risk.
- **Using `INNER JOIN` for "all employees with their manager".** It drops the top of the hierarchy.

## When to use it vs alternatives

| Need | Use |
|---|---|
| One level of hierarchy (employee → manager) | Self join |
| Full chain to the top | `WITH RECURSIVE` CTE |
| Pairs sharing a value | Self join with `t1.id < t2.id` |
| Just the groups that have duplicates | `GROUP BY col HAVING COUNT(*) > 1` |
| Every combination of two different tables | `CROSS JOIN` |

If the question is "which cities have more than one customer?", `GROUP BY` is simpler. Use the self join when you must list the actual pairs.

## Interview questions

### What is a self join in SQL?
A self join is a join of a table with itself using two aliases, so one copy can represent, for example, employees and the other managers. It uses normal `JOIN` syntax; there is no special keyword. It is common for hierarchies and for finding related rows within one table.

### How do you avoid duplicate pairs in a self join?
Add `t1.id < t2.id` to the join condition along with the shared-value equality. That removes rows paired with themselves and keeps only one ordering of each pair. Using `<>` would return each pair twice.

### How do you find employees who have no manager?
Select from `employees` where `reports_to IS NULL`. To show everyone with their manager's name, use a `LEFT JOIN` from employee to manager, so employees without a manager still appear with NULL.

### When should you use a recursive CTE instead of a self join?
When the hierarchy depth is unknown and you need every level, such as all indirect reports of a manager. A self join handles one fixed level per join; `WITH RECURSIVE` walks the tree until no more rows match.

## Practice

Practice this pattern with the questions below.
