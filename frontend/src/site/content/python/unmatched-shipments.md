---
id: PY-095
title: Orders Missing Shipments And Orphan Shipments
slug: unmatched-shipments
difficulty: Medium
category: dsa
skill: validation
description: Use sets to find orders never shipped and shipments with no matching order.
topic: python-collections
concepts: set difference, symmetric checks
time: O(n log n)
space: O(n)
minutes: 10
---

## Scenario

Finance reconciles the order system against the carrier feed every morning. Both directions of mismatch must be reported.

## Problem

Write unmatched(orders, shipments). orders is a list of order dicts with 'order_id' and 'status'; shipments is a list of dicts with 'order_id'. Ignore orders with status 'cancelled'. Return {'not_shipped': sorted ids of active orders with no shipment, 'orphans': sorted ids of shipments whose order_id is not any order (cancelled included)}.

## Objective

Apply set operations to a two-way reconciliation.

## Input format

Two lists of dicts.

## Output format

dict with two sorted lists.

## Constraints

- Duplicate ids appear once in output
- Status comparison is case-insensitive

## Examples

```
orders=[{'order_id':1,'status':'paid'},{'order_id':2,'status':'cancelled'}], shipments=[{'order_id':3}]  ->  {'not_shipped':[1],'orphans':[3]}
```

## Hints

- Build three sets: all order ids, active order ids, shipped ids.
- Two set differences give the answer.

## Why it matters

Two-way key reconciliation between systems is a standard data contract check. Sets make it O(n) instead of nested loops.

```task
{
  "id": "unmatched-shipments",
  "title": "Orders Missing Shipments And Orphan Shipments",
  "type": "python",
  "instructions": "Write unmatched(orders, shipments). orders is a list of order dicts with 'order_id' and 'status'; shipments is a list of dicts with 'order_id'. Ignore orders with status 'cancelled'. Return {'not_shipped': sorted ids of active orders with no shipment, 'orphans': sorted ids of shipments whose order_id is not any order (cancelled included)}.",
  "starter": "def unmatched(orders: list, shipments: list) -> dict:\n    raise NotImplementedError\n",
  "solution": "def unmatched(orders: list, shipments: list) -> dict:\n    all_ids = {o['order_id'] for o in orders}\n    active = {o['order_id'] for o in orders if str(o.get('status', '')).lower() != 'cancelled'}\n    shipped = {s['order_id'] for s in shipments}\n    return {'not_shipped': sorted(active - shipped), 'orphans': sorted(shipped - all_ids)}\n",
  "tests": "assert unmatched([{'order_id':1,'status':'paid'},{'order_id':2,'status':'cancelled'}], [{'order_id':3}]) == {'not_shipped':[1],'orphans':[3]}\nassert unmatched([{'order_id':1,'status':'paid'}], [{'order_id':1}]) == {'not_shipped':[],'orphans':[]}\n",
  "hidden": "assert unmatched([], []) == {'not_shipped':[],'orphans':[]}\nassert unmatched([{'order_id':2,'status':'CANCELLED'}], [{'order_id':2}]) == {'not_shipped':[],'orphans':[]}\nassert unmatched([], [{'order_id':5},{'order_id':5}]) == {'not_shipped':[],'orphans':[5]}\no=[{'order_id':i,'status':'paid'} for i in range(1000)]\ns=[{'order_id':i} for i in range(1,1001)]\nassert unmatched(o,s) == {'not_shipped':[0],'orphans':[1000]}\n",
  "explanation": "Building sets once makes each membership test O(1). active minus shipped gives unshipped live orders, while shipped minus all ids catches orphans, deliberately counting cancelled orders as known so their shipments are not flagged. Sorting gives stable output and sets collapse duplicates."
}
```
