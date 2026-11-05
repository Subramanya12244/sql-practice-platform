---
id: PY-094
title: Order Class With Validated Lines
slug: order-line-class
difficulty: Medium
category: fundamentals
skill: validation
description: Build an Order class that validates line items and computes totals.
topic: python-oop
concepts: classes, properties, ValueError
time: O(k log k)
space: O(k)
minutes: 15
---

## Scenario

An order service sends line items to the warehouse feed. Bad quantities must be rejected at the point of entry.

## Problem

Write class Order(order_id). Method add_line(sku, qty, unit_price) raises ValueError if qty is not a positive int or unit_price is negative; adding the same sku again increases its qty (price must match, else ValueError). Property total returns the sum of qty*unit_price rounded to 2 decimals. Method to_dict() returns {'order_id':..., 'lines':[{'sku','qty','unit_price'} sorted by sku], 'total':...}.

## Objective

Encapsulate record validation and derived fields in a small class.

## Input format

Calls to Order methods.

## Output format

Totals and a dict.

## Constraints

- bool is not a valid qty
- Round total to 2 decimals

## Examples

```
o=Order('A1'); o.add_line('X',2,1.5); o.add_line('X',1,1.5); o.total -> 4.5
```

## Hints

- Store lines in a dict keyed by sku.
- isinstance(True, int) is True, so check bool explicitly.

## Why it matters

Domain objects that validate on construction keep bad data out of pipelines. Serialising them to dicts is how they reach JSON sinks.

```task
{
  "id": "order-line-class",
  "title": "Order Class With Validated Lines",
  "type": "python",
  "instructions": "Write class Order(order_id). Method add_line(sku, qty, unit_price) raises ValueError if qty is not a positive int or unit_price is negative; adding the same sku again increases its qty (price must match, else ValueError). Property total returns the sum of qty*unit_price rounded to 2 decimals. Method to_dict() returns {'order_id':..., 'lines':[{'sku','qty','unit_price'} sorted by sku], 'total':...}.",
  "starter": "class Order:\n    def __init__(self, order_id):\n        raise NotImplementedError\n",
  "solution": "class Order:\n    def __init__(self, order_id):\n        self.order_id = order_id\n        self._lines = {}\n\n    def add_line(self, sku, qty, unit_price):\n        if not isinstance(qty, int) or isinstance(qty, bool) or qty <= 0:\n            raise ValueError('bad qty')\n        if unit_price < 0:\n            raise ValueError('bad price')\n        if sku in self._lines:\n            if self._lines[sku][1] != unit_price:\n                raise ValueError('price mismatch')\n            self._lines[sku][0] += qty\n        else:\n            self._lines[sku] = [qty, unit_price]\n\n    @property\n    def total(self):\n        return round(sum(q * p for q, p in self._lines.values()), 2)\n\n    def to_dict(self):\n        lines = [{'sku': s, 'qty': q, 'unit_price': p} for s, (q, p) in sorted(self._lines.items())]\n        return {'order_id': self.order_id, 'lines': lines, 'total': self.total}\n",
  "tests": "o=Order('A1'); o.add_line('X',2,1.5); o.add_line('X',1,1.5)\nassert o.total == 4.5\no.add_line('B',1,0.1)\nassert o.to_dict() == {'order_id':'A1','lines':[{'sku':'B','qty':1,'unit_price':0.1},{'sku':'X','qty':3,'unit_price':1.5}],'total':4.6}\n",
  "hidden": "def bad(f):\n    try:\n        f(); return False\n    except ValueError:\n        return True\no=Order('Z')\nassert o.total == 0\nassert bad(lambda: o.add_line('A',0,1))\nassert bad(lambda: o.add_line('A',True,1))\nassert bad(lambda: o.add_line('A',1,-1))\no.add_line('A',1,2)\nassert bad(lambda: o.add_line('A',1,3))\nassert o.to_dict()['lines'] == [{'sku':'A','qty':1,'unit_price':2}]\n",
  "explanation": "Lines are kept in a dict keyed by sku so repeated adds merge in O(1). Validation runs before any mutation, so a rejected call leaves the order unchanged. The bool check matters because bool subclasses int. total is a property, so it is always derived from current lines and cannot drift."
}
```
