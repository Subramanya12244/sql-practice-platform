---
title: SELF JOIN
slug: self-join
category: joins
difficulty: Intermediate
description: Join a table to itself with SQL self joins - employee-manager hierarchies, pairs sharing a value, a.id < b.id deduplication, and comparing rows.
prerequisites: [inner-join, left-join]
related: [inner-join, left-join, recursive-cte, lag, join-cardinality]
questions: [61, 62, 63, 64, 66]
patterns: [self-referencing, hierarchical-queries, find-duplicates]
guides: [self-join]
minutes: 7
version: 1
---

## Introduction

A self join joins a table to itself. It is used when rows relate to other rows in the same table, such as an employee and their manager.

## Definition

A self join is an ordinary join where both sides are the same table under different aliases: `employees e JOIN employees m ON m.employee_id = e.reports_to`.

## Why it matters

Hierarchies (manager, parent category) and "pairs of rows sharing X" are common interview problems. The key skills are aliasing and removing mirrored duplicate pairs.

## How it works

PostgreSQL treats each alias as a separate input. Any join type works. For pair-finding, `a.id < b.id` keeps each unordered pair once and excludes a row pairing with itself.

## Syntax

```sql-syntax
SELECT a.col, b.col
FROM table_name a
JOIN table_name b ON b.parent_id = a.id;

-- unique pairs sharing a value
SELECT a.id, b.id
FROM table_name a
JOIN table_name b ON b.shared_col = a.shared_col AND a.id < b.id;
```

## Simple examples

Each employee with their manager. `LEFT JOIN` keeps the top manager:

```sql
SELECT e.employee_id,
       e.first_name || ' ' || e.last_name AS employee,
       m.first_name || ' ' || m.last_name AS manager
FROM employees e
LEFT JOIN employees m ON m.employee_id = e.reports_to
ORDER BY e.employee_id;
```

Employees with no manager:

```sql
SELECT employee_id, first_name, last_name, title
FROM employees
WHERE reports_to IS NULL;
```

## Intermediate examples

Managers and how many direct reports they have:

```sql
SELECT m.employee_id, m.first_name || ' ' || m.last_name AS manager,
       COUNT(e.employee_id) AS direct_reports
FROM employees m
JOIN employees e ON e.reports_to = m.employee_id
GROUP BY m.employee_id, manager
ORDER BY direct_reports DESC;
```

Pairs of customers in the same city (each pair once):

```sql
SELECT a.customer_id, b.customer_id, a.city
FROM customers a
JOIN customers b ON b.city = a.city AND a.customer_id < b.customer_id
ORDER BY a.city, a.customer_id
LIMIT 8;
```

## Advanced examples

Three aliases: colleagues reporting to the same manager, with the manager's name.

```sql
SELECT m.last_name AS manager, a.last_name AS employee_1, b.last_name AS employee_2
FROM employees a
JOIN employees b ON b.reports_to = a.reports_to AND a.employee_id < b.employee_id
JOIN employees m ON m.employee_id = a.reports_to
ORDER BY manager, employee_1, employee_2
LIMIT 8;
```

Compare a row with another row: employees hired before their own manager.

```sql
SELECT e.last_name, e.hire_date, m.last_name AS manager, m.hire_date AS manager_hired
FROM employees e
JOIN employees m ON m.employee_id = e.reports_to
WHERE e.hire_date < m.hire_date;
```

## Real-world scenarios

- Org charts and approval chains (one level per self join).
- Product or category hierarchies.
- Finding duplicates or near-duplicates (same email, same address).
- Comparing an order with the same customer's previous order (often replaced by `LAG`).

## PostgreSQL specifics

- For hierarchies of unknown depth, use `WITH RECURSIVE` instead of chaining self joins.
- Window functions (`LAG`, `LEAD`) replace many "compare with previous row" self joins and scan the table once.

## Visual explanation

```text
employees e                     employees m (same table)
id  name       reports_to       id  name
1   Davolio    2  ───────────►  2   Fuller
5   Buchanan   2  ───────────►  2   Fuller
6   Suyama     5  ───────────►  5   Buchanan
2   Fuller     NULL ─────────►  (no match → NULL with LEFT JOIN)
```

## Common mistakes

- Forgetting aliases, so column references are ambiguous.
- Using `a.id <> b.id` for pairs: each pair appears twice (A,B and B,A). Use `<`.
- Using `INNER JOIN` for the manager lookup and losing the top of the hierarchy.
- Chaining many self joins for deep hierarchies instead of a recursive CTE.

## Performance

Index the self-referencing column (`reports_to`) and the matching column for pair searches. Pair queries grow quadratically with group size; filter first. Prefer window functions over self joins for "previous/next row" comparisons.

## Interview questions

### What is a self join?

A join of a table with itself using two aliases, used when rows reference other rows in the same table.

### How do you list each employee with their manager's name?

`employees e LEFT JOIN employees m ON m.employee_id = e.reports_to`. `LEFT` keeps the employee without a manager.

### How do you avoid duplicate pairs in a self join?

Add `a.id < b.id`. It removes self-pairs and mirrored pairs.

### When should you not use a self join?

For hierarchies of unknown depth (use a recursive CTE) and previous/next-row comparisons (use `LAG`/`LEAD`).

## Quick revision

- Same table, two aliases.
- `LEFT JOIN` for parent lookups to keep root rows.
- `a.id < b.id` for unique pairs.
- Recursive CTE for arbitrary depth.
- `LAG`/`LEAD` often replace row-comparison self joins.
