---
id: PY-003
title: Dedupe Preserving Order
slug: dedupe-preserve-order
difficulty: Easy
category: dsa
skill: deduplication
description: Remove duplicates from a list while keeping first-seen order.
topic: python-collections
concepts: sets, ordered output, hashing
time: O(n)
space: O(n)
minutes: 10
---

## Scenario

An event stream replays some messages after a consumer restart, so the same event IDs appear more than once. Downstream needs each event once, in the order it was first received.

## Problem

Write `def dedupe(items: list) -> list` that returns the items with duplicates removed, keeping the
first occurrence of each and the original order. Items are hashable (`None` counts as a value).

## Objective

Return the items with duplicates removed, keeping each first occurrence in original order.

## Input format

A list of hashable items.

## Output format

A new list without duplicates, first-seen order.

## Constraints

- None is a value like any other
- O(n)

## Examples

```
dedupe([3, 1, 3, 2, 1])  ->  [3, 1, 2]
dedupe([])  ->  []
```

## Hints

- Track seen items in a `set` for O(1) lookups.
- `list(dict.fromkeys(items))` is a one-line alternative.

## Why it matters

At-least-once delivery means duplicates are normal, and an order-preserving set-based dedupe is the standard O(n) fix.

```task
{
  "id": "dedupe-preserve-order",
  "title": "Dedupe Preserving Order",
  "type": "python",
  "instructions": "Write `def dedupe(items: list) -> list` that returns the items with duplicates removed, keeping the\nfirst occurrence of each and the original order. Items are hashable (`None` counts as a value).",
  "starter": "def dedupe(items: list) -> list:\n    raise NotImplementedError\n",
  "solution": "def dedupe(items: list) -> list:\n    seen = set()\n    out = []\n    for x in items:\n        if x not in seen:\n            seen.add(x)\n            out.append(x)\n    return out\n",
  "tests": "assert dedupe([3, 1, 3, 2, 1]) == [3, 1, 2]\nassert dedupe([]) == []\nassert dedupe([None, None, 0]) == [None, 0]\n",
  "hidden": "assert dedupe([\"a\", \"A\", \"a\"]) == [\"a\", \"A\"]\nassert dedupe([1, 2, 3]) == [1, 2, 3]\n",
  "explanation": "A set gives O(1) 'have I seen this?' checks while the output list keeps the original order. `list(dict.fromkeys(items))` does the same because dicts preserve insertion order."
}
```
