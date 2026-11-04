---
title: Purchase order vs receipt reconciliation
slug: po-receipt-reconciliation
dataset: inventory
difficulty: Hard
description: Reconcile received purchase orders (source) against warehouse receipt movements (target): row counts, matches and mismatches.
notes: [full-outer-join, filter-clause, except]
patterns: [unmatched-records, missing-records, conditional-aggregation]
---

## Business context
Procurement marks purchase orders as received, while the warehouse system records a receipt movement when stock arrives. Before month-end close, finance wants a reconciliation summary between the two systems: how many records each side has, how many agree, and how many disagree or are missing.

## Problem
Treat purchase orders with `status = 'received'` as the source and receipt movements linked to a purchase order as the target, aggregated to one quantity per `po_id`. Produce a single summary row.

## Available data
- `purchase_orders`: `po_id`, `quantity`, `status` (`draft`, `ordered`, `received`, `cancelled`)
- `stock_movements`: `movement_id`, `movement_type` (`receipt`, ...), `quantity`, `po_id` (NULL for non-PO movements)

## Expected outcome
Finance signs off the close if mismatches are zero; otherwise each mismatched PO is investigated.

## Success criteria
- Output columns, exactly: `source_rows`, `target_rows`, `matched_rows`, `quantity_mismatches`, `missing_in_target`, `missing_in_source`
- `source_rows` = number of received POs; `target_rows` = number of distinct `po_id` values on `receipt` movements.
- `matched_rows` = POs on both sides with PO quantity equal to the summed receipt quantity; `quantity_mismatches` = on both sides with different quantities.
- `missing_in_target` = received POs with no receipt; `missing_in_source` = receipt `po_id`s whose PO is not in `received` status.
- Exactly one row.

```solution
WITH src AS (
  SELECT po_id, quantity FROM purchase_orders WHERE status = 'received'
),
tgt AS (
  SELECT po_id, SUM(quantity) AS quantity
  FROM stock_movements
  WHERE movement_type = 'receipt' AND po_id IS NOT NULL
  GROUP BY po_id
)
SELECT COUNT(s.po_id) AS source_rows,
       COUNT(t.po_id) AS target_rows,
       COUNT(*) FILTER (WHERE s.po_id IS NOT NULL AND t.po_id IS NOT NULL AND s.quantity = t.quantity) AS matched_rows,
       COUNT(*) FILTER (WHERE s.po_id IS NOT NULL AND t.po_id IS NOT NULL AND s.quantity <> t.quantity) AS quantity_mismatches,
       COUNT(*) FILTER (WHERE t.po_id IS NULL) AS missing_in_target,
       COUNT(*) FILTER (WHERE s.po_id IS NULL) AS missing_in_source
FROM src s
FULL OUTER JOIN tgt t ON t.po_id = s.po_id;
```

```alternative
WITH src AS (
  SELECT po_id, quantity FROM purchase_orders WHERE status = 'received'
),
tgt AS (
  SELECT po_id, SUM(quantity) AS quantity
  FROM stock_movements
  WHERE movement_type = 'receipt' AND po_id IS NOT NULL
  GROUP BY po_id
)
SELECT (SELECT COUNT(*) FROM src) AS source_rows,
       (SELECT COUNT(*) FROM tgt) AS target_rows,
       (SELECT COUNT(*) FROM (SELECT * FROM src INTERSECT SELECT * FROM tgt) m) AS matched_rows,
       (SELECT COUNT(*) FROM src s JOIN tgt t ON t.po_id = s.po_id AND t.quantity <> s.quantity) AS quantity_mismatches,
       (SELECT COUNT(*) FROM (SELECT po_id FROM src EXCEPT SELECT po_id FROM tgt) x) AS missing_in_target,
       (SELECT COUNT(*) FROM (SELECT po_id FROM tgt EXCEPT SELECT po_id FROM src) x) AS missing_in_source;
```

## Explanation
A FULL OUTER JOIN on the business key lines up both systems; a NULL key on one side marks a record missing from that side, and comparing quantities splits matched from mismatched. `COUNT(col)` skips NULLs, which gives each side's row count from the same join. The alternative computes each metric independently with set operators: `INTERSECT` on (po_id, quantity) for exact matches and `EXCEPT` on keys for missing rows. Aggregating receipts per PO first is essential, because one PO may arrive in several deliveries.

## Follow-up questions
### How do you list the mismatched POs themselves?
Select from the same FULL OUTER JOIN with `WHERE s.quantity IS DISTINCT FROM t.quantity`, adding a CASE that labels each issue.
### Why aggregate the target before joining?
Without it a PO delivered in two receipts would appear twice and never match its single PO quantity.
