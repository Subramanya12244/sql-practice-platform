---
title: Recursive CTE
slug: recursive-cte
category: ctes
difficulty: Advanced
description: Use WITH RECURSIVE in PostgreSQL to walk hierarchies like org charts, generate series and traverse graphs, with cycle protection.
prerequisites: [cte, union-all, self-join]
related: [cte, multiple-ctes, self-join, union-all]
questions: [61, 62, 63]
patterns: [hierarchical-queries, self-referencing, consecutive-dates]
guides: [self-join, cte]
minutes: 10
version: 1
---

## Introduction

A recursive CTE repeats a query, feeding each round's output into the next, until no new rows appear. It is the standard SQL way to walk trees such as org charts.

## Definition

`WITH RECURSIVE name AS (anchor UNION [ALL] recursive_term)` where the recursive term references `name`. Execution stops when the recursive term returns no rows.

## Why it matters

- Self-joins only reach a fixed number of levels. Recursion handles any depth.
- Classic interview tasks: management chain, all reports under a manager, number sequences, date gaps.

## How it works

1. Run the anchor query. Its rows form the result and the "working table".
2. Run the recursive term against the working table only.
3. Append new rows to the result. They become the new working table.
4. Repeat until the recursive term returns zero rows.

## Syntax

```sql-syntax
WITH RECURSIVE cte_name (col1, col2, depth) AS (
    SELECT ...                      -- anchor: starting rows
    UNION ALL
    SELECT ...                      -- recursive term
    FROM source_table t
    JOIN cte_name c ON t.parent_id = c.id
)
SELECT * FROM cte_name;
```

## Simple examples

Generate numbers 1 to 5:

```sql
WITH RECURSIVE nums (n) AS (
    SELECT 1
    UNION ALL
    SELECT n + 1 FROM nums WHERE n < 5
)
SELECT n FROM nums;
```

## Intermediate examples

Org chart from the top manager down, with level:

```sql
WITH RECURSIVE org AS (
    SELECT employee_id, first_name, last_name, reports_to, 1 AS level
    FROM employees
    WHERE reports_to IS NULL
    UNION ALL
    SELECT e.employee_id, e.first_name, e.last_name, e.reports_to, o.level + 1
    FROM employees e
    JOIN org o ON e.reports_to = o.employee_id
)
SELECT employee_id, first_name, last_name, reports_to, level
FROM org
ORDER BY level, employee_id;
```

All direct and indirect reports of employee 5:

```sql
WITH RECURSIVE reports AS (
    SELECT employee_id, reports_to FROM employees WHERE reports_to = 5
    UNION ALL
    SELECT e.employee_id, e.reports_to
    FROM employees e
    JOIN reports r ON e.reports_to = r.employee_id
)
SELECT employee_id FROM reports ORDER BY employee_id;
```

## Advanced examples

Full management path as a string, walking upward from each employee:

```sql
WITH RECURSIVE chain AS (
    SELECT employee_id AS start_id, employee_id, reports_to,
           first_name::text AS path
    FROM employees
    UNION ALL
    SELECT c.start_id, m.employee_id, m.reports_to,
           c.path || ' -> ' || m.first_name
    FROM chain c
    JOIN employees m ON m.employee_id = c.reports_to
)
SELECT start_id, path
FROM chain
WHERE reports_to IS NULL
ORDER BY start_id;
```

Fill missing days between the first and last order in January 2024, then count orders per day:

```sql
WITH RECURSIVE days AS (
    SELECT DATE '2024-01-01' AS d
    UNION ALL
    SELECT d + 1 FROM days WHERE d < DATE '2024-01-31'
)
SELECT d, COUNT(o.order_id) AS n_orders
FROM days
LEFT JOIN orders o ON o.order_date = d
GROUP BY d
ORDER BY d
LIMIT 10;
```

Cycle protection with the PostgreSQL 14+ `CYCLE` clause:

```sql
WITH RECURSIVE org AS (
    SELECT employee_id, reports_to FROM employees WHERE reports_to IS NULL
    UNION ALL
    SELECT e.employee_id, e.reports_to
    FROM employees e JOIN org o ON e.reports_to = o.employee_id
) CYCLE employee_id SET is_cycle USING visited
SELECT employee_id, reports_to, is_cycle FROM org ORDER BY employee_id;
```

## Real-world scenarios

- Org charts, category trees, bill of materials.
- Graph reachability (routes, referrals).
- Calendar generation to expose gaps in data.

## PostgreSQL specifics

- The keyword `RECURSIVE` is required in PostgreSQL. SQL Server omits it.
- PostgreSQL 14+ supports `SEARCH DEPTH FIRST / BREADTH FIRST BY` and `CYCLE ... SET ... USING` clauses.
- For simple number or date ranges, `generate_series()` is shorter and faster than a recursive CTE.

## Visual explanation

```text
Iteration 0 (anchor):  2 (VP, reports_to NULL)
Iteration 1:           1, 3, 4, 5, 8   (reports_to = 2)
Iteration 2:           6, 7, 9         (reports_to = 5)
Iteration 3:           (no rows) -> stop
```

## Common mistakes

- No termination condition, giving infinite recursion on cyclic data or counters.
- Using `UNION` when you need duplicates, or `UNION ALL` on cyclic graphs without a guard.
- Column type mismatch between anchor and recursive term, e.g. `varchar` vs `text` in a path. Cast in the anchor.
- Referencing the CTE more than once in the recursive term, or inside an aggregate. Not allowed.

## Performance

- Each iteration is a join against the working table. Index the parent key (`reports_to`).
- Add a depth limit (`WHERE level < 20`) as a safety net.
- `UNION` (not `ALL`) removes duplicates each round. It prevents some cycles but costs extra work.

## Interview questions

### What are the two parts of a recursive CTE?

An anchor query giving the starting rows and a recursive term that references the CTE. They are joined with `UNION` or `UNION ALL`.

### When does recursion stop?

When the recursive term returns no new rows.

### How do you prevent infinite loops?

Add a depth limit, track visited ids in an array, use `UNION` to drop repeats, or use the PostgreSQL 14+ `CYCLE` clause.

### How would you find every employee under a given manager?

Anchor on the manager's direct reports, then repeatedly join `employees.reports_to` to the CTE's `employee_id`.

## Quick revision

- `WITH RECURSIVE` = anchor `UNION ALL` recursive term.
- Recursive term sees only the previous iteration's rows.
- Stops when no new rows are produced.
- Guard against cycles: depth limit, `CYCLE`, or visited array.
- Cast text columns in the anchor to avoid type errors.
- Prefer `generate_series()` for plain ranges in PostgreSQL.
