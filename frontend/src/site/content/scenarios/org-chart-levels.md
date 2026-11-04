---
title: Org chart levels and top manager
slug: org-chart-levels
dataset: hr
difficulty: Hard
description: Assign every employee a level in the management hierarchy and identify the top-level person their chain ends at.
orderBy: employee_id
notes: [recursive-cte, self-join, null-handling]
patterns: [hierarchical-queries, self-referencing]
---

## Business context
The people-analytics team is rebuilding the org chart for a new HR system. They need to know how deep each person sits in the hierarchy and who is at the top of their reporting chain. They suspect not everyone rolls up to the CEO.

## Problem
For every employee (active or not), compute their level in the hierarchy, where anyone with no manager is level 1, their direct reports level 2, and so on. Also return the employee at the top of their chain.

## Available data
- `employees`: `employee_id`, `first_name`, `last_name`, `manager_id` (NULL for top-level people)

## Expected outcome
The new HR system imports the levels; employees whose top manager is not the CEO are flagged for review.

## Success criteria
- Output columns, exactly: `employee_id`, `full_name`, `level`, `top_manager_id`
- `full_name` = `first_name || ' ' || last_name`.
- Employees with NULL `manager_id` are level 1 and are their own `top_manager_id`.
- Include all employees, including terminated ones.
- Sort by `employee_id`.

```solution
WITH RECURSIVE tree AS (
  SELECT employee_id, 1 AS level, employee_id AS top_manager_id
  FROM employees
  WHERE manager_id IS NULL
  UNION ALL
  SELECT e.employee_id, t.level + 1, t.top_manager_id
  FROM employees e
  JOIN tree t ON e.manager_id = t.employee_id
)
SELECT t.employee_id, e.first_name || ' ' || e.last_name AS full_name, t.level, t.top_manager_id
FROM tree t
JOIN employees e ON e.employee_id = t.employee_id
ORDER BY t.employee_id;
```

```alternative
WITH RECURSIVE up AS (
  SELECT employee_id, employee_id AS node_id, manager_id, 1 AS depth
  FROM employees
  UNION ALL
  SELECT u.employee_id, m.employee_id, m.manager_id, u.depth + 1
  FROM up u
  JOIN employees m ON m.employee_id = u.manager_id
)
SELECT u.employee_id, e.first_name || ' ' || e.last_name AS full_name,
       u.depth AS level, u.node_id AS top_manager_id
FROM up u
JOIN employees e ON e.employee_id = u.employee_id
WHERE u.manager_id IS NULL
ORDER BY u.employee_id;
```

## Explanation
The top-down version anchors on every root (NULL manager) and pushes level and root id down to each report. The bottom-up version starts from every employee and climbs one manager at a time; the row where the climb reaches a NULL manager carries both the depth and the root. Because the dataset has two roots (the CEO and a contractor without a manager), anchoring only on employee 1 would silently lose part of the tree.

## Follow-up questions
### How would you show the full path, e.g. "1 > 4 > 17"?
Carry a text or array column in the recursive CTE: `path || e.employee_id`.
### How do you find employees who do not roll up to the CEO?
Filter the result with `top_manager_id <> 1`.
