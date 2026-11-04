---
title: Self-referencing tables
slug: self-referencing
category: hierarchy
difficulty: Intermediate
description: Query a table whose foreign key points to itself (employees.reports_to) with a self join to show each row next to its parent.
questions: [61, 62, 63, 64]
notes: [self-join, left-join, inner-join, null-handling]
guides: [self-join]
---

## Problem

A table refers to itself: `employees.reports_to` holds the `employee_id` of each employee's manager. Show every employee with the manager's name, count each manager's direct reports, and compare employees with their manager.

## When to use it

- Employee and manager, category and parent category, comment and reply.
- One-level lookups. For all levels, see the hierarchical-queries pattern.

## Solution

```sql
SELECT e.employee_id,
       e.first_name || ' ' || e.last_name AS employee,
       m.first_name || ' ' || m.last_name AS manager
FROM employees e
LEFT JOIN employees m ON m.employee_id = e.reports_to
ORDER BY e.employee_id;
```

## Alternatives

Managers with their number of direct reports:

```sql
SELECT m.employee_id, m.first_name, m.last_name, COUNT(e.employee_id) AS direct_reports
FROM employees m
JOIN employees e ON e.reports_to = m.employee_id
GROUP BY m.employee_id, m.first_name, m.last_name
ORDER BY direct_reports DESC;
```

Employees hired before their manager (compare a row with its parent):

```sql
SELECT e.first_name || ' ' || e.last_name AS employee, e.hire_date,
       m.first_name || ' ' || m.last_name AS manager,  m.hire_date AS manager_hired
FROM employees e
JOIN employees m ON m.employee_id = e.reports_to
WHERE e.hire_date < m.hire_date;
```

Pairs of colleagues with the same manager (`<` keeps each pair once):

```sql
SELECT a.first_name AS employee_a, b.first_name AS employee_b, a.reports_to AS manager_id
FROM employees a
JOIN employees b ON b.reports_to = a.reports_to
               AND a.employee_id < b.employee_id
ORDER BY manager_id, employee_a;
```

`LEFT JOIN` keeps the top manager, whose `reports_to` is NULL. `INNER JOIN` keeps only rows with a parent.

## How it works

Give the same table two aliases, one per role (`e` for employee, `m` for manager). Join the child's foreign key to the parent's primary key. Each alias then behaves like a separate table.

## Execution walkthrough

1. `e` scans all 9 employees.
2. For each one, `m` is looked up by `m.employee_id = e.reports_to`.
3. The Vice President has `reports_to` NULL, so `LEFT JOIN` returns NULL for the manager.
4. Concatenation with `||` gives NULL when any part is NULL, so the manager column is NULL.

## Common mistakes

- Reversing the join (`m.reports_to = e.employee_id`), which lists reports instead of managers.
- `INNER JOIN` when the top of the hierarchy must appear.
- Pair queries with `<>` instead of `<`, which returns each pair twice.

## Performance

Index the self-referencing column (`reports_to`). PostgreSQL does not index foreign-key columns automatically.
