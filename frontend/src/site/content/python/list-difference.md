---
id: PY-042
title: List Difference, Order Kept
slug: list-difference
difficulty: Easy
category: dsa
skill: transformation
description: Items of one list that aren't in another, keeping order.
topic: python-collections
concepts: sets for lookup, comprehension
time: O(n + m)
space: O(m)
minutes: 5
---

## Scenario

A nightly job has the list of order IDs in today's extract and the list already loaded into the warehouse. It must find which extract rows still need loading, keeping their original order and repeats.

## Problem

Return the items of `a` that do not appear in `b`, in a's order, keeping a's duplicates.

## Objective

Return the items of a that do not appear in b, in a's order and keeping a's duplicates.

## Input format

Two lists of hashable values.

## Output format

A list.

## Constraints

- Keep duplicates from a

## Examples

```
difference([1, 2, 2, 3], [2])  ->  [1, 3]
difference([3, 3], [])  ->  [3, 3]
```

## Hints

- Turn b into a set for fast membership tests.
- Loop over a, so its order and duplicates are kept.

## Why it matters

This is an anti-join, the core of finding new or missing records, and using a set for lookups keeps it linear instead of quadratic.

```task
{
  "id": "list-difference",
  "title": "List Difference, Order Kept",
  "type": "python",
  "instructions": "Return the items of `a` that do not appear in `b`, in a's order, keeping a's duplicates.",
  "starter": "def difference(a: list, b: list) -> list:\n    raise NotImplementedError\n",
  "solution": "def difference(a: list, b: list) -> list:\n    exclude = set(b)\n    return [x for x in a if x not in exclude]\n",
  "tests": "assert difference([1, 2, 2, 3], [2]) == [1, 3]\nassert difference([3, 3], []) == [3, 3]\n",
  "hidden": "assert difference([], [1]) == []\nassert difference(['a', 'b'], ['a', 'b']) == []\nassert difference(list(range(10000)), list(range(5000)))[0] == 5000\n",
  "explanation": "Set membership is O(1), so the whole function is O(len(a) + len(b)); testing `x not in b` on a list would be O(len(a) × len(b))."
}
```
