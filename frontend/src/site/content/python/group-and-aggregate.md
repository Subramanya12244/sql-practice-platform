---
title: Group and Aggregate a List of Dicts
slug: group-and-aggregate
difficulty: Easy
description: Sum and count order amounts per customer, like GROUP BY in plain Python.
topic: python-loops
minutes: 15
---

## Problem

Write `def aggregate(rows: list, key: str, value: str) -> dict` returning
`{group: {"count": int, "total": number}}`. Rows whose `value` is `None` still count toward `count`
but add nothing to `total`. Rows missing the `key` are skipped.

## Examples

```
aggregate([{"c": "a", "amt": 5}, {"c": "a", "amt": 3}, {"c": "b", "amt": None}], "c", "amt")
  ->  {"a": {"count": 2, "total": 8}, "b": {"count": 1, "total": 0}}
```

## Hints

- Initialise each group with `{'count': 0, 'total': 0}`.
- `collections.defaultdict` saves the existence check.

```task
{
  "id": "group-and-aggregate",
  "title": "Group and Aggregate a List of Dicts",
  "type": "python",
  "instructions": "Write `def aggregate(rows: list, key: str, value: str) -> dict` returning\n`{group: {\"count\": int, \"total\": number}}`. Rows whose `value` is `None` still count toward `count`\nbut add nothing to `total`. Rows missing the `key` are skipped.",
  "starter": "def aggregate(rows: list, key: str, value: str) -> dict:\n    raise NotImplementedError\n",
  "solution": "def aggregate(rows: list, key: str, value: str) -> dict:\n    out = {}\n    for r in rows:\n        if key not in r:\n            continue\n        g = out.setdefault(r[key], {\"count\": 0, \"total\": 0})\n        g[\"count\"] += 1\n        v = r.get(value)\n        if v is not None:\n            g[\"total\"] += v\n    return out\n",
  "tests": "assert aggregate([{\"c\": \"a\", \"amt\": 5}, {\"c\": \"a\", \"amt\": 3}, {\"c\": \"b\", \"amt\": None}], \"c\", \"amt\") == {\"a\": {\"count\": 2, \"total\": 8}, \"b\": {\"count\": 1, \"total\": 0}}\nassert aggregate([], \"c\", \"amt\") == {}\nassert aggregate([{\"amt\": 1}], \"c\", \"amt\") == {}\nassert aggregate([{\"c\": \"x\", \"amt\": 1.5}, {\"c\": \"x\"}], \"c\", \"amt\") == {\"x\": {\"count\": 2, \"total\": 1.5}}\n"
}
```
