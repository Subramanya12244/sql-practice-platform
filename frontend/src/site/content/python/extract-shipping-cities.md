---
id: PY-036
title: Extract Shipping Cities
slug: extract-shipping-cities
difficulty: Easy
category: processing
skill: parsing
description: Pull the city out of nested order JSON safely.
topic: python-csv-json
concepts: nested dicts, safe access
time: O(n)
space: O(n)
minutes: 6
---

## Scenario

The order API nests the address as order -> shipping -> address -> city, but some orders are digital and have no shipping block.

## Problem

Write `shipping_cities(orders)` returning a list of (order_id, city) tuples. City is None if any level is missing or not a dict.

## Objective

Pair each order id with its nested shipping city, using None when any level is missing.

## Input format

A list of order dicts.

## Output format

A list of tuples.

## Constraints

- Keep order

## Examples

```
shipping_cities([{'id': 1, 'shipping': {'address': {'city': 'Pune'}}}, {'id': 2}])  ->  [(1, 'Pune'), (2, None)]
```

## Hints

- Walk down level by level.
- Stop and return None when the current value is not a dict.

## Why it matters

API payloads are nested and inconsistent. Safe nested access keeps one odd record from crashing the parser.

```task
{
  "id": "extract-shipping-cities",
  "title": "Extract Shipping Cities",
  "type": "python",
  "instructions": "Write `shipping_cities(orders)` returning a list of (order_id, city) tuples. City is None if any level is missing or not a dict.",
  "starter": "def shipping_cities(orders):\n    raise NotImplementedError\n",
  "solution": "def shipping_cities(orders):\n    out = []\n    for o in orders:\n        cur = o\n        for key in ('shipping', 'address', 'city'):\n            cur = cur.get(key) if isinstance(cur, dict) else None\n        out.append((o.get('id'), cur))\n    return out\n",
  "tests": "assert shipping_cities([{'id': 1, 'shipping': {'address': {'city': 'Pune'}}}, {'id': 2}]) == [(1, 'Pune'), (2, None)]\n",
  "hidden": "assert shipping_cities([]) == []\nassert shipping_cities([{'id': 3, 'shipping': None}]) == [(3, None)]\nassert shipping_cities([{'id': 4, 'shipping': {'address': 'n/a'}}]) == [(4, None)]\nassert shipping_cities([{'id': 5, 'shipping': {'address': {}}}]) == [(5, None)]\n",
  "explanation": "The loop descends one key at a time and only calls get on dicts. Any missing or non-dict level turns the result into None."
}
```
