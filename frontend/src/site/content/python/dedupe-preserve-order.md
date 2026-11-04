---
title: Dedupe Preserving Order
slug: dedupe-preserve-order
difficulty: Easy
description: Remove duplicates from a list while keeping first-seen order.
topic: python-collections
minutes: 10
---

## Problem

Write `def dedupe(items: list) -> list` that returns the items with duplicates removed, keeping the
first occurrence of each and the original order. Items are hashable (`None` counts as a value).

## Examples

```
dedupe([3, 1, 3, 2, 1])  ->  [3, 1, 2]
dedupe([])  ->  []
```

## Hints

- Track seen items in a `set` for O(1) lookups.
- `list(dict.fromkeys(items))` is a one-line alternative.

```task
{
  "id": "dedupe-preserve-order",
  "title": "Dedupe Preserving Order",
  "type": "python",
  "instructions": "Write `def dedupe(items: list) -> list` that returns the items with duplicates removed, keeping the\nfirst occurrence of each and the original order. Items are hashable (`None` counts as a value).",
  "starter": "def dedupe(items: list) -> list:\n    raise NotImplementedError\n",
  "solution": "def dedupe(items: list) -> list:\n    seen = set()\n    out = []\n    for x in items:\n        if x not in seen:\n            seen.add(x)\n            out.append(x)\n    return out\n",
  "tests": "assert dedupe([3, 1, 3, 2, 1]) == [3, 1, 2]\nassert dedupe([]) == []\nassert dedupe([None, None, 0]) == [None, 0]\nassert dedupe([\"a\", \"A\", \"a\"]) == [\"a\", \"A\"]\nassert dedupe([1, 2, 3]) == [1, 2, 3]\n"
}
```
