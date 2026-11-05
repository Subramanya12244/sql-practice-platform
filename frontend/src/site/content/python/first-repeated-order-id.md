---
id: PY-039
title: First Repeated Order ID
slug: first-repeated-order-id
difficulty: Easy
category: dsa
skill: deduplication
description: Find the first order id that appears twice in a batch.
topic: python-collections
concepts: set membership, early return
time: O(n)
space: O(n)
minutes: 5
---

## Scenario

An ingestion check must stop a batch that contains duplicate order ids and report which id repeated first.

## Problem

Write `first_repeat(order_ids)` returning the first id whose second occurrence comes earliest in the list, or None if all ids are unique.

## Objective

Return the order id whose second occurrence appears earliest, or None if all ids are unique.

## Input format

A list of ids.

## Output format

An id or None.

## Constraints

- O(n) time

## Examples

```
first_repeat(['A1', 'B2', 'C3', 'B2', 'A1'])  ->  'B2'
first_repeat(['A1'])  ->  None
```

## Hints

- Track ids you've seen in a set.
- Return as soon as you meet one that is already in the set.

## Why it matters

Primary key checks run before loading to protect target tables. A set-based scan finds the offender in one pass even for big batches.

```task
{
  "id": "first-repeated-order-id",
  "title": "First Repeated Order ID",
  "type": "python",
  "instructions": "Write `first_repeat(order_ids)` returning the first id whose second occurrence comes earliest in the list, or None if all ids are unique.",
  "starter": "def first_repeat(order_ids):\n    raise NotImplementedError\n",
  "solution": "def first_repeat(order_ids):\n    seen = set()\n    for oid in order_ids:\n        if oid in seen:\n            return oid\n        seen.add(oid)\n    return None\n",
  "tests": "assert first_repeat(['A1', 'B2', 'C3', 'B2', 'A1']) == 'B2'\nassert first_repeat(['A1']) is None\n",
  "hidden": "assert first_repeat([]) is None\nassert first_repeat(list(range(100000)) + [5]) == 5\nassert first_repeat([1, 1]) == 1\nassert first_repeat(['a', 'b', 'c']) is None\n",
  "explanation": "Set membership is O(1) on average, so one pass is enough. The first id found already in the set is the one whose repeat occurs earliest."
}
```
