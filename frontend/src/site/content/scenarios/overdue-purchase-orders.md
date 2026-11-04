---
title: Overdue purchase orders
slug: overdue-purchase-orders
dataset: inventory
difficulty: Easy
description: List open purchase orders whose expected delivery date has passed as of the last recorded stock movement.
orderBy: days_overdue, po_id
notes: [inner-join, multiple-joins, date-time-functions]
patterns: []
---

## Business context
The procurement manager wants to chase suppliers who are late. Every purchase order still in `ordered` status whose expected delivery date is already in the past should be on the call sheet, with the supplier, product and destination warehouse.

## Problem
Using the date of the latest stock movement as "today", list `ordered` purchase orders whose `expected_date` is before that date, with how many days late they are.

## Available data
- `purchase_orders`: `po_id`, `supplier_id`, `warehouse_id`, `product_id`, `expected_date` (may be NULL), `status`
- `suppliers`: `supplier_id`, `supplier_name`
- `products`: `product_id`, `product_name`
- `warehouses`: `warehouse_id`, `name`
- `stock_movements`: `moved_at`

## Expected outcome
Buyers call suppliers starting with the most overdue order.

## Success criteria
- Output columns, exactly: `po_id`, `supplier_name`, `product_name`, `warehouse_name`, `expected_date`, `days_overdue`
- Anchor date = `MAX(moved_at)::date` from `stock_movements`.
- Only `status = 'ordered'` with non-NULL `expected_date` earlier than the anchor.
- `days_overdue` = anchor minus `expected_date` (integer days).
- Sort by `days_overdue` descending, then `po_id`.

```solution
WITH anchor AS (SELECT MAX(moved_at)::date AS as_of FROM stock_movements)
SELECT po.po_id, s.supplier_name, p.product_name, w.name AS warehouse_name, po.expected_date,
       a.as_of - po.expected_date AS days_overdue
FROM purchase_orders po
JOIN suppliers s ON s.supplier_id = po.supplier_id
JOIN products p ON p.product_id = po.product_id
JOIN warehouses w ON w.warehouse_id = po.warehouse_id
CROSS JOIN anchor a
WHERE po.status = 'ordered' AND po.expected_date < a.as_of
ORDER BY days_overdue DESC, po.po_id;
```

```alternative
SELECT x.po_id, x.supplier_name, x.product_name, x.warehouse_name, x.expected_date, x.days_overdue
FROM (
  SELECT po.po_id,
         (SELECT supplier_name FROM suppliers s WHERE s.supplier_id = po.supplier_id) AS supplier_name,
         (SELECT product_name FROM products p WHERE p.product_id = po.product_id) AS product_name,
         (SELECT name FROM warehouses w WHERE w.warehouse_id = po.warehouse_id) AS warehouse_name,
         po.expected_date,
         (SELECT MAX(moved_at)::date FROM stock_movements) - po.expected_date AS days_overdue
  FROM purchase_orders po
  WHERE po.status = 'ordered'
) x
WHERE x.days_overdue > 0
ORDER BY x.days_overdue DESC, x.po_id;
```

## Explanation
Fix "today" to a date taken from the data so the report is reproducible, then filter open orders whose expected date is before it. The alternative looks up names with scalar subqueries and filters on the computed lateness; a NULL `expected_date` gives NULL lateness, which `> 0` discards, matching the solution.

## Follow-up questions
### How would you rank suppliers by lateness?
Group the result by supplier and report `COUNT(*)` and `AVG(days_overdue)`.
### Should draft orders be included?
No: drafts have not been sent to the supplier, so they cannot be late.
