---
title: Quarterly quota attainment by rep
slug: quota-attainment
dataset: sales
difficulty: Medium
description: Compare each sales rep's booked revenue with their quarterly target and compute attainment, counting quarters with no sales.
orderBy: rep_id, year, quarter
notes: [left-join, sum, date-time-functions, scalar-subqueries]
patterns: [conditional-aggregation]
---

## Business context
Sales leadership is calculating commissions and wants a quota attainment report for every rep quarter that had a target. A rep who sold nothing in a quarter still needs a row showing zero, because that affects their pay.

## Problem
For every row in the targets table, compute the rep's revenue in that calendar year and quarter and the percentage of target achieved.

## Available data
- `sales_targets`: `rep_id`, `year`, `quarter`, `target_amount`
- `sales_reps`: `rep_id`, `first_name`, `last_name`
- `orders`: `order_id`, `rep_id`, `order_date`, `status`
- `order_items`: `order_id`, `quantity`, `unit_price`, `discount`

## Expected outcome
Commission is paid on `attainment_pct`; reps below target get a coaching plan.

## Success criteria
- Output columns, exactly: `rep_id`, `rep_name`, `year`, `quarter`, `target_amount`, `actual_revenue`, `attainment_pct`
- `rep_name` = `first_name || ' ' || last_name`.
- Revenue = `quantity * unit_price * (1 - discount)` from orders credited to the rep (`orders.rep_id`), excluding status `cancelled` and `returned`.
- Year/quarter come from `order_date` (`EXTRACT(YEAR ...)`, `EXTRACT(QUARTER ...)`).
- A target quarter with no qualifying sales shows `actual_revenue = 0.00` and `attainment_pct = 0.00`.
- `actual_revenue` and `attainment_pct` (= 100 * actual / target) rounded with `ROUND(x::numeric, 2)`.
- Sort by `rep_id`, `year`, `quarter`.

```solution
WITH rev AS (
  SELECT o.rep_id,
         EXTRACT(YEAR FROM o.order_date)::int AS yr,
         EXTRACT(QUARTER FROM o.order_date)::int AS qtr,
         SUM(i.quantity * i.unit_price * (1 - i.discount)) AS revenue
  FROM orders o
  JOIN order_items i ON i.order_id = o.order_id
  WHERE o.status NOT IN ('cancelled', 'returned') AND o.rep_id IS NOT NULL
  GROUP BY 1, 2, 3
)
SELECT t.rep_id, r.first_name || ' ' || r.last_name AS rep_name, t.year, t.quarter, t.target_amount,
       ROUND(COALESCE(v.revenue, 0)::numeric, 2) AS actual_revenue,
       ROUND((100 * COALESCE(v.revenue, 0) / t.target_amount)::numeric, 2) AS attainment_pct
FROM sales_targets t
JOIN sales_reps r ON r.rep_id = t.rep_id
LEFT JOIN rev v ON v.rep_id = t.rep_id AND v.yr = t.year AND v.qtr = t.quarter
ORDER BY t.rep_id, t.year, t.quarter;
```

```alternative
SELECT x.rep_id, x.rep_name, x.year, x.quarter, x.target_amount,
       ROUND(x.revenue::numeric, 2) AS actual_revenue,
       ROUND((100 * x.revenue / x.target_amount)::numeric, 2) AS attainment_pct
FROM (
  SELECT t.rep_id, r.first_name || ' ' || r.last_name AS rep_name, t.year, t.quarter, t.target_amount,
         (SELECT COALESCE(SUM(i.quantity * i.unit_price * (1 - i.discount)), 0)
          FROM orders o
          JOIN order_items i ON i.order_id = o.order_id
          WHERE o.rep_id = t.rep_id
            AND o.status NOT IN ('cancelled', 'returned')
            AND o.order_date >= make_date(t.year, 3 * t.quarter - 2, 1)
            AND o.order_date <  make_date(t.year, 3 * t.quarter - 2, 1) + INTERVAL '3 months') AS revenue
  FROM sales_targets t
  JOIN sales_reps r ON r.rep_id = t.rep_id
) x
ORDER BY x.rep_id, x.year, x.quarter;
```

## Explanation
Start from the targets table so every quota row survives, and LEFT JOIN the aggregated revenue; `COALESCE` turns quarters without sales into zero. The alternative computes revenue per target row with a correlated subquery over a date range built by `make_date`, which can use an index on `order_date`. Orders with NULL `rep_id` (unassigned customers) belong to nobody's quota.

## Follow-up questions
### Which reps sold without having a target?
Reps 24 and 25 have no targets; find their revenue with an anti-join from `rev` to `sales_targets`.
### Should returned orders reduce attainment?
Policy question; here they are excluded entirely. Some companies instead book them as negative revenue in the quarter of the return.
