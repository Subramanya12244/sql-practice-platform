---
title: Gaps and islands
slug: gaps-and-islands
category: dates
difficulty: Advanced
description: Group consecutive rows into islands and find gaps between them using LAG with a running SUM of break flags, or the ROW_NUMBER difference trick.
questions: [104, 109, 119]
notes: [lag, lead, running-totals, row-number]
guides: [gaps-and-islands]
---

## Problem

Split ordered rows into islands of consecutive values and list the gaps between them. Example: runs of consecutive order ids handled by the same employee, and the gaps in the order id sequence.

## When to use it

- Sessions from event timestamps (a new session after 30 minutes of inactivity).
- Periods during which a status stayed the same.
- Missing ranges in ids or dates.

## Solution

Islands of consecutive orders taken by the same employee, using a break flag and a running sum:

```sql
WITH flagged AS (
  SELECT order_id, employee_id,
         CASE WHEN employee_id IS DISTINCT FROM LAG(employee_id) OVER (ORDER BY order_id)
              THEN 1 ELSE 0 END AS is_break
  FROM orders
),
islands AS (
  SELECT order_id, employee_id,
         SUM(is_break) OVER (ORDER BY order_id) AS island_id
  FROM flagged
)
SELECT island_id, employee_id,
       MIN(order_id) AS first_order, MAX(order_id) AS last_order, COUNT(*) AS orders
FROM islands
GROUP BY island_id, employee_id
ORDER BY orders DESC, island_id
LIMIT 10;
```

## Alternatives

Gaps: ranges of missing values between existing ones, using `LEAD`:

```sql
WITH ids AS (
  SELECT product_id AS id FROM order_details
  UNION
  SELECT 0
)
SELECT id + 1 AS gap_start, next_id - 1 AS gap_end
FROM (SELECT id, LEAD(id) OVER (ORDER BY id) AS next_id FROM ids) t
WHERE next_id > id + 1;
```

Islands of consecutive integers with the row-number difference trick:

```sql
WITH ids AS (SELECT DISTINCT product_id AS id FROM order_details)
SELECT MIN(id) AS island_start, MAX(id) AS island_end, COUNT(*) AS size
FROM (SELECT id, id - ROW_NUMBER() OVER (ORDER BY id) AS grp FROM ids) t
GROUP BY grp
ORDER BY island_start;
```

The flag-and-sum method works for any "new group starts when …" rule, such as a value change or a time gap. The row-number difference only works for consecutive integers or dates.

## How it works

`LAG` compares each row with the previous one. A row that starts a new island gets flag 1. A running `SUM` of the flags gives every row in the same island the same number. Group by that number to describe each island. Gaps lie between one island's last value and the next island's first value.

## Execution walkthrough

1. `flagged` sets `is_break = 1` when the employee differs from the previous order's employee. `IS DISTINCT FROM` treats the NULL employee as a value.
2. `islands` sums the flags in order, so the island id increases by 1 at every change.
3. The final query groups by island and reports its range and length.

## Common mistakes

- Using `<>` instead of `IS DISTINCT FROM` when the column can be NULL. A NULL comparison returns NULL, so no break is flagged.
- Forgetting that the first row has no previous row. `LAG` returns NULL there, which `IS DISTINCT FROM` treats as a break.
- Ordering the running sum by a different key than `LAG`.

## Performance

Both windows share the same `ORDER BY`, so PostgreSQL sorts once. The final `GROUP BY` is a hash aggregate. An index on the ordering column avoids the sort.
