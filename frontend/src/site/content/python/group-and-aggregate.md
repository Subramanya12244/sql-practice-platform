---
id: PY-006
title: Group and Aggregate a List of Dicts
slug: group-and-aggregate
difficulty: Easy
category: processing
skill: aggregation
description: Sum and count order amounts per customer, like GROUP BY in plain Python.
topic: python-loops
concepts: dict.setdefault, grouping, None values
time: O(n)
space: O(g)
minutes: 15
---

## Scenario

Order rows from an e-commerce export carry a region and an amount, but some amounts are None and some rows lack the region field. Finance wants the order count and total amount per region.

## Problem

Write `def aggregate(rows: list, key: str, value: str) -> dict` returning
`{group: {"count": int, "total": number}}`. Rows whose `value` is `None` still count toward `count`
but add nothing to `total`. Rows missing the `key` are skipped.

## Objective

Return {group: {'count', 'total'}} where None values still count but add nothing, and rows missing the key are skipped.

## Input format

A list of dicts, a key field and a value field.

## Output format

A dict of group → {'count', 'total'}.

## Constraints

- Rows without the key field are skipped
- None values count but add 0

## Examples

```
aggregate([{"c": "a", "amt": 5}, {"c": "a", "amt": 3}, {"c": "b", "amt": None}], "c", "amt")
  ->  {"a": {"count": 2, "total": 8}, "b": {"count": 1, "total": 0}}
```

## Hints

- Initialise each group with `{'count': 0, 'total': 0}`.
- `collections.defaultdict` saves the existence check.

## Why it matters

Group-by aggregation is the most common transformation in data work, and handling None and missing keys explicitly mirrors how SQL COUNT(*) and SUM differ on NULLs.

```task
{
  "id": "group-and-aggregate",
  "title": "Group and Aggregate a List of Dicts",
  "type": "python",
  "instructions": "Write `def aggregate(rows: list, key: str, value: str) -> dict` returning\n`{group: {\"count\": int, \"total\": number}}`. Rows whose `value` is `None` still count toward `count`\nbut add nothing to `total`. Rows missing the `key` are skipped.",
  "starter": "def aggregate(rows: list, key: str, value: str) -> dict:\n    raise NotImplementedError\n",
  "solution": "def aggregate(rows: list, key: str, value: str) -> dict:\n    out = {}\n    for r in rows:\n        if key not in r:\n            continue\n        g = out.setdefault(r[key], {\"count\": 0, \"total\": 0})\n        g[\"count\"] += 1\n        v = r.get(value)\n        if v is not None:\n            g[\"total\"] += v\n    return out\n",
  "tests": "assert aggregate([{\"c\": \"a\", \"amt\": 5}, {\"c\": \"a\", \"amt\": 3}, {\"c\": \"b\", \"amt\": None}], \"c\", \"amt\") == {\"a\": {\"count\": 2, \"total\": 8}, \"b\": {\"count\": 1, \"total\": 0}}\nassert aggregate([], \"c\", \"amt\") == {}\n",
  "hidden": "assert aggregate([{\"amt\": 1}], \"c\", \"amt\") == {}\nassert aggregate([{\"c\": \"x\", \"amt\": 1.5}, {\"c\": \"x\"}], \"c\", \"amt\") == {\"x\": {\"count\": 2, \"total\": 1.5}}\n",
  "explanation": "`setdefault` creates each group's accumulator on first sight, so one pass groups and sums. Counting rows separately from summing values lets None values count as a row while contributing nothing, like SQL's COUNT(*) versus SUM(col)."
}
```
