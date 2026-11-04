---
title: Hierarchical queries
slug: hierarchical-queries
category: hierarchy
difficulty: Advanced
description: Walk an org chart or tree of any depth with WITH RECURSIVE, tracking level and path, and listing all ancestors or all descendants.
questions: [61, 62, 63]
notes: [recursive-cte, cte, self-join, string-functions]
guides: [self-join, cte]
---

## Problem

Walk a hierarchy of unknown depth: list every employee with their level in the org chart and the full reporting chain, or find everyone under a given manager.

## When to use it

- Org charts, category trees, bill of materials, folder structures.
- Any question that needs "all levels", not just the direct parent.

## Solution

```sql
WITH RECURSIVE org AS (
  SELECT employee_id, first_name, reports_to,
         1 AS level,
         first_name::text AS path
  FROM employees
  WHERE reports_to IS NULL
  UNION ALL
  SELECT e.employee_id, e.first_name, e.reports_to,
         org.level + 1,
         org.path || ' > ' || e.first_name
  FROM employees e
  JOIN org ON e.reports_to = org.employee_id
)
SELECT employee_id, level, path
FROM org
ORDER BY path;
```

## Alternatives

All descendants of one manager (employee 2), excluding the manager:

```sql
WITH RECURSIVE reports AS (
  SELECT employee_id, first_name FROM employees WHERE reports_to = 2
  UNION ALL
  SELECT e.employee_id, e.first_name
  FROM employees e
  JOIN reports r ON e.reports_to = r.employee_id
)
SELECT * FROM reports ORDER BY employee_id;
```

All ancestors of one employee (walk up from employee 9):

```sql
WITH RECURSIVE chain AS (
  SELECT employee_id, first_name, reports_to, 0 AS steps_up
  FROM employees WHERE employee_id = 9
  UNION ALL
  SELECT m.employee_id, m.first_name, m.reports_to, c.steps_up + 1
  FROM employees m
  JOIN chain c ON m.employee_id = c.reports_to
)
SELECT * FROM chain ORDER BY steps_up;
```

Cycle protection with PostgreSQL 14+ `CYCLE` clause, for data that may contain loops:

```sql
WITH RECURSIVE org AS (
  SELECT employee_id, reports_to FROM employees WHERE reports_to IS NULL
  UNION ALL
  SELECT e.employee_id, e.reports_to
  FROM employees e JOIN org ON e.reports_to = org.employee_id
) CYCLE employee_id SET is_cycle USING visited
SELECT employee_id, reports_to, is_cycle FROM org;
```

Self joins handle a fixed number of levels. `WITH RECURSIVE` handles any depth. Oracle also has `CONNECT BY`, which PostgreSQL does not support.

## How it works

A recursive CTE has two parts joined by `UNION ALL`. The anchor query returns the starting rows. The recursive query joins the table to the rows produced in the previous step. PostgreSQL repeats the recursive step until it returns no new rows.

## Execution walkthrough

1. Anchor: the employee with no manager (level 1, path "Andrew").
2. Step 1: employees whose `reports_to` is that employee get level 2.
3. Step 2: employees reporting to level-2 employees get level 3, with the path extended.
4. Step 3 finds nobody, so recursion stops and all rows are returned.

## Common mistakes

- Forgetting `RECURSIVE`. PostgreSQL then says the CTE name does not exist inside itself.
- Type mismatch between anchor and recursive parts, for example a `varchar(50)` path that grows. Cast the anchor to `text`.
- No stop condition on cyclic data, which loops forever. Use `CYCLE`, a path array check, or a depth limit.
- Using `UNION` instead of `UNION ALL` to hide cycles. It is slower and does not fix wrong data.

## Performance

Each step is a join with the previous step's rows, so index the parent column (`reports_to`). Depth, not table size, sets the number of iterations.
