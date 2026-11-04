---
title: Total reports per manager
slug: reporting-chain
dataset: northwind
difficulty: Hard
description: Count every direct and indirect report under each Northwind manager by walking the reports_to hierarchy.
notes: [recursive-cte, self-join]
patterns: [hierarchical-queries, self-referencing]
---

## Business context
HR is redesigning the bonus plan so that managers are rewarded on the size of the whole organisation below them, not just their direct reports. They need a headcount per manager that includes people several levels down.

## Problem
For every employee who has at least one report, count all employees below them in the hierarchy (direct reports, their reports, and so on).

## Available data
- `employees`: `employee_id`, `first_name`, `last_name`, `reports_to` (NULL for the top of the hierarchy)

## Expected outcome
HR uses the counts to assign each manager to a bonus band.

## Success criteria
- Output columns, exactly: `employee_id`, `employee_name`, `total_reports`
- `employee_name` = `first_name || ' ' || last_name`.
- Only employees with `total_reports >= 1` appear.
- Each subordinate is counted once per manager above them.

```solution
WITH RECURSIVE sub AS (
  SELECT reports_to AS manager_id, employee_id
  FROM employees
  WHERE reports_to IS NOT NULL
  UNION ALL
  SELECT s.manager_id, e.employee_id
  FROM sub s
  JOIN employees e ON e.reports_to = s.employee_id
)
SELECT m.employee_id, m.first_name || ' ' || m.last_name AS employee_name,
       COUNT(DISTINCT s.employee_id) AS total_reports
FROM sub s
JOIN employees m ON m.employee_id = s.manager_id
GROUP BY m.employee_id, m.first_name, m.last_name;
```

```alternative
WITH RECURSIVE up AS (
  SELECT employee_id, reports_to AS ancestor_id
  FROM employees
  WHERE reports_to IS NOT NULL
  UNION ALL
  SELECT u.employee_id, a.reports_to
  FROM up u
  JOIN employees a ON a.employee_id = u.ancestor_id
  WHERE a.reports_to IS NOT NULL
)
SELECT m.employee_id, m.first_name || ' ' || m.last_name AS employee_name,
       COUNT(DISTINCT u.employee_id) AS total_reports
FROM employees m
JOIN up u ON u.ancestor_id = m.employee_id
GROUP BY m.employee_id, m.first_name, m.last_name;
```

## Explanation
The solution walks down: start from direct manager/report pairs and repeatedly attach the reports of anyone already found, keeping the original manager. The alternative walks up: for every employee, list each ancestor until the top. Both produce the full (manager, subordinate) closure, and grouping by manager gives the count.

## Follow-up questions
### How would you also return direct reports only?
Count rows of `employees` grouped by `reports_to`, or add a depth column to the recursive CTE and filter `depth = 1`.
### What protects the query from a cycle in reports_to?
Nothing here; in PostgreSQL 14+ add `CYCLE employee_id SET is_cycle USING path`, or track a path array and stop when an id repeats.
