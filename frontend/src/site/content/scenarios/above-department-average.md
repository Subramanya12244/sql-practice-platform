---
title: Employees paid above their department average
slug: above-department-average
dataset: hr
difficulty: Medium
description: List active employees whose salary is above the average salary of active staff in their own department.
notes: [avg, partition-by, correlated-subqueries]
patterns: []
---

## Business context
The compensation committee is reviewing pay equity. Before the meeting they want to see which current employees earn more than the typical colleague in the same department, so they can check whether the premium is justified by role or performance.

## Problem
For every active employee who belongs to a department, compare their salary with the average salary of the active employees in that department and keep only those strictly above it.

## Available data
- `employees`: `employee_id`, `first_name`, `last_name`, `salary`, `department_id` (may be NULL), `is_active`
- `departments`: `department_id`, `department_name`

## Expected outcome
The committee gets a short list of above-average earners per department to review against job grades.

## Success criteria
- Output columns, exactly: `employee_id`, `full_name`, `department_name`, `salary`, `dept_avg_salary`
- `full_name` = `first_name || ' ' || last_name`.
- Only active employees (`is_active = TRUE`) are included, and only they count toward the average.
- Employees with NULL `department_id` are excluded.
- Compare against the unrounded average; show `dept_avg_salary` rounded with `ROUND(x::numeric, 2)`.
- Salary equal to the average is not "above".

```solution
WITH active AS (
  SELECT e.*, AVG(e.salary) OVER (PARTITION BY e.department_id) AS dept_avg
  FROM employees e
  WHERE e.is_active AND e.department_id IS NOT NULL
)
SELECT a.employee_id, a.first_name || ' ' || a.last_name AS full_name,
       d.department_name, a.salary, ROUND(a.dept_avg::numeric, 2) AS dept_avg_salary
FROM active a
JOIN departments d ON d.department_id = a.department_id
WHERE a.salary > a.dept_avg;
```

```alternative
SELECT e.employee_id, e.first_name || ' ' || e.last_name AS full_name,
       d.department_name, e.salary, ROUND(da.avg_salary::numeric, 2) AS dept_avg_salary
FROM employees e
JOIN departments d ON d.department_id = e.department_id
JOIN (
  SELECT department_id, AVG(salary) AS avg_salary
  FROM employees
  WHERE is_active AND department_id IS NOT NULL
  GROUP BY department_id
) da ON da.department_id = e.department_id
WHERE e.is_active AND e.salary > da.avg_salary;
```

```alternative
SELECT e.employee_id, e.first_name || ' ' || e.last_name AS full_name,
       d.department_name, e.salary,
       ROUND((SELECT AVG(x.salary) FROM employees x
              WHERE x.department_id = e.department_id AND x.is_active)::numeric, 2) AS dept_avg_salary
FROM employees e
JOIN departments d ON d.department_id = e.department_id
WHERE e.is_active
  AND e.salary > (SELECT AVG(x.salary) FROM employees x
                  WHERE x.department_id = e.department_id AND x.is_active);
```

## Explanation
A window `AVG ... OVER (PARTITION BY department_id)` attaches the department average to every row without collapsing them, so the filter can compare row against group. The derived-table version computes averages once per department and joins them back; the correlated subquery recomputes per row. All three must restrict the average to active staff, otherwise terminated employees' old salaries skew the benchmark.

## Follow-up questions
### What if the committee wants the top earner per department instead?
Use `RANK() OVER (PARTITION BY department_id ORDER BY salary DESC)` and keep rank 1; salaries are rounded to thousands so expect ties.
### Why does the employee with no department disappear?
The inner join to `departments` (and the partition filter) drops NULL `department_id`; list them separately with `WHERE department_id IS NULL` if HR needs to fix the data.
