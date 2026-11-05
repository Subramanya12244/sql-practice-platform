---
id: PY-082
title: Inventory Reorder Report
slug: inventory-reorder
difficulty: Medium
category: processing
skill: transformation
description: Find products that need reordering.
topic: python-etl-pipelines
concepts: list of dicts, filtering, sorting by key
time: O(n log n)
space: O(n)
minutes: 10
---

## Scenario

A warehouse system lists products with current stock, units already on order and a reorder level. Purchasing wants a list of active products that will fall short, biggest shortfall first.

## Problem

Each product is a dict with name, stock, on_order and reorder_level. Return (name, shortfall) for active products where stock + on_order < reorder_level, shortfall = reorder_level − stock − on_order, largest shortfall first then by name. Skip products with 'discontinued': True.

## Objective

Return (name, shortfall) for non-discontinued products below their reorder level, sorted by shortfall desc then name.

## Input format

A list of dicts.

## Output format

A list of tuples.

## Constraints

- 'discontinued' may be missing (means False)

## Examples

```
reorder_report([{'name': 'Tea', 'stock': 2, 'on_order': 0, 'reorder_level': 10}])  ->  [('Tea', 8)]
```

## Hints

- Use `p.get('discontinued', False)`.
- Sort with key=lambda t: (-t[1], t[0]).

## Why it matters

Business rules like this are typical of downstream marts, and expressing filter, derive and sort clearly is what makes them easy to test and trust.

```task
{
  "id": "inventory-reorder",
  "title": "Inventory Reorder Report",
  "type": "python",
  "instructions": "Each product is a dict with name, stock, on_order and reorder_level. Return (name, shortfall) for active products where stock + on_order < reorder_level, shortfall = reorder_level − stock − on_order, largest shortfall first then by name. Skip products with 'discontinued': True.",
  "starter": "def reorder_report(products: list) -> list:\n    raise NotImplementedError\n",
  "solution": "def reorder_report(products: list) -> list:\n    out = []\n    for p in products:\n        if p.get('discontinued', False):\n            continue\n        short = p['reorder_level'] - p['stock'] - p['on_order']\n        if short > 0:\n            out.append((p['name'], short))\n    return sorted(out, key=lambda t: (-t[1], t[0]))\n",
  "tests": "assert reorder_report([{'name': 'Tea', 'stock': 2, 'on_order': 0, 'reorder_level': 10}]) == [('Tea', 8)]\n",
  "hidden": "ps = [\n    {'name': 'B', 'stock': 0, 'on_order': 0, 'reorder_level': 5},\n    {'name': 'A', 'stock': 0, 'on_order': 0, 'reorder_level': 5},\n    {'name': 'C', 'stock': 5, 'on_order': 0, 'reorder_level': 5},\n    {'name': 'D', 'stock': 0, 'on_order': 9, 'reorder_level': 5},\n    {'name': 'E', 'stock': 0, 'on_order': 0, 'reorder_level': 50, 'discontinued': True},\n    {'name': 'F', 'stock': 1, 'on_order': 1, 'reorder_level': 20, 'discontinued': False},\n]\nassert reorder_report(ps) == [('F', 18), ('A', 5), ('B', 5)]\nassert reorder_report([]) == []\n",
  "explanation": "Goods already on order count towards stock, so the shortfall subtracts both. Sorting by (−shortfall, name) puts the most urgent first and breaks ties alphabetically."
}
```
