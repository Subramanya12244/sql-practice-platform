---
id: PY-045
title: Merge Dictionaries By Summing
slug: merge-dicts-sum
difficulty: Easy
category: fundamentals
skill: aggregation
description: Combine two count dictionaries, adding values for shared keys.
topic: python-collections
concepts: dicts, loops, get
time: O(n + m)
space: O(n + m)
minutes: 5
---

## Scenario

Two regional warehouses each report a dict of SKU to units sold today. Head office wants one combined count per SKU without altering either regional report.

## Problem

Return a new dict containing every key from `a` and `b`; keys present in both get the sum of their values. Don't modify the inputs.

## Objective

Return a new dict with every key from both inputs, summing the values of shared keys.

## Input format

Two dicts of key → number.

## Output format

A new dict.

## Constraints

- Inputs must not change

## Examples

```
merge_counts({'x': 1, 'y': 2}, {'y': 3, 'z': 4})  ->  {'x': 1, 'y': 5, 'z': 4}
```

## Hints

- Start from a copy of a.
- Loop over b's items and add.

## Why it matters

Combining partial counts from shards, partitions or regions is the core of map-reduce style aggregation, and doing it without mutating inputs keeps reruns safe.

```task
{
  "id": "merge-dicts-sum",
  "title": "Merge Dictionaries By Summing",
  "type": "python",
  "instructions": "Return a new dict containing every key from `a` and `b`; keys present in both get the sum of their values. Don't modify the inputs.",
  "starter": "def merge_counts(a: dict, b: dict) -> dict:\n    raise NotImplementedError\n",
  "solution": "def merge_counts(a: dict, b: dict) -> dict:\n    out = dict(a)\n    for k, v in b.items():\n        out[k] = out.get(k, 0) + v\n    return out\n",
  "tests": "assert merge_counts({'x': 1, 'y': 2}, {'y': 3, 'z': 4}) == {'x': 1, 'y': 5, 'z': 4}\n",
  "hidden": "a, b = {'k': 1}, {'k': 2}\nassert merge_counts(a, b) == {'k': 3} and a == {'k': 1} and b == {'k': 2}\nassert merge_counts({}, {}) == {}\nassert merge_counts({'n': -1}, {'n': 1}) == {'n': 0}\n",
  "explanation": "`dict(a)` makes a shallow copy, so the original stays unchanged. Adding b's values with `get(k, 0)` handles keys that exist in only one dict."
}
```
