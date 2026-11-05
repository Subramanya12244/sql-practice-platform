---
id: PY-059
title: Sort Products by Price Then Name
slug: sort-products-price-name
difficulty: Easy
category: fundamentals
skill: transformation
description: Order a product feed by price, breaking ties by name.
topic: python-lambdas
concepts: sorted, key lambda, tuple keys
time: O(n log n)
space: O(n)
minutes: 5
---

## Scenario

The storefront export must list products cheapest first, and ties must be stable so diffs between daily files stay small.

## Problem

Write `sort_products(products)` returning a new list sorted by 'price' ascending, then by 'name' ascending (case-insensitive). Products with price None go last.

## Objective

Return products ordered by price then case-insensitive name, with missing prices last.

## Input format

A list of product dicts.

## Output format

A new sorted list.

## Constraints

- Do not sort in place

## Examples

```
sort_products([{'name': 'b', 'price': 2}, {'name': 'A', 'price': 2}, {'name': 'c', 'price': 1}])  ->  [c, A, b]
```

## Hints

- A key can return a tuple.
- Put (price is None) first in the tuple so None sorts last.

## Why it matters

Deterministic ordering makes output files diffable and tests repeatable. Tuple sort keys are the standard way to express multi-column ORDER BY in Python.

```task
{
  "id": "sort-products-price-name",
  "title": "Sort Products by Price Then Name",
  "type": "python",
  "instructions": "Write `sort_products(products)` returning a new list sorted by 'price' ascending, then by 'name' ascending (case-insensitive). Products with price None go last.",
  "starter": "def sort_products(products):\n    raise NotImplementedError\n",
  "solution": "def sort_products(products):\n    return sorted(products, key=lambda p: (p['price'] is None, p['price'] or 0, p['name'].lower()))\n",
  "tests": "r = sort_products([{'name': 'b', 'price': 2}, {'name': 'A', 'price': 2}, {'name': 'c', 'price': 1}])\nassert [p['name'] for p in r] == ['c', 'A', 'b']\n",
  "hidden": "assert sort_products([]) == []\nr = sort_products([{'name': 'x', 'price': None}, {'name': 'y', 'price': 0}])\nassert [p['name'] for p in r] == ['y', 'x']\nsrc = [{'name': 'b', 'price': 1}, {'name': 'a', 'price': 1}]\nsort_products(src)\nassert src[0]['name'] == 'b'\n",
  "explanation": "The tuple key sorts first by whether price is missing, then by price, then by lowercase name. sorted returns a new list so the input stays unchanged."
}
```
