---
id: PY-041
title: Invert A Dictionary
slug: invert-dict
difficulty: Easy
category: fundamentals
skill: transformation
description: Swap keys and values, rejecting duplicate values.
topic: python-collections
concepts: dict comprehension, items, validation
time: O(n)
space: O(n)
minutes: 5
---

## Scenario

A lookup table maps internal product codes to the SKU codes a partner uses. The reverse feed sends SKUs, so you need the mapping the other way round, and a duplicated SKU would mean two products collapse into one.

## Problem

Return a dict with keys and values swapped. If two keys share a value, raise `ValueError` instead of silently losing one.

## Objective

Return the mapping with keys and values swapped, raising ValueError when two keys share a value.

## Input format

`mapping`: a dict with hashable values.

## Output format

A new dict.

## Constraints

- Duplicate values raise ValueError

## Examples

```
invert({'a': 1, 'b': 2})  ->  {1: 'a', 2: 'b'}
```

## Hints

- Compare the number of distinct values with the number of keys.
- `{v: k for k, v in mapping.items()}`.

## Why it matters

Reverse lookups are a daily tool for code mappings, and failing loudly on duplicates prevents a join key from silently losing rows.

```task
{
  "id": "invert-dict",
  "title": "Invert A Dictionary",
  "type": "python",
  "instructions": "Return a dict with keys and values swapped. If two keys share a value, raise `ValueError` instead of silently losing one.",
  "starter": "def invert(mapping: dict) -> dict:\n    raise NotImplementedError\n",
  "solution": "def invert(mapping: dict) -> dict:\n    if len(set(mapping.values())) != len(mapping):\n        raise ValueError('values are not unique')\n    return {v: k for k, v in mapping.items()}\n",
  "tests": "assert invert({'a': 1, 'b': 2}) == {1: 'a', 2: 'b'}\nassert invert({}) == {}\n",
  "hidden": "try:\n    invert({'a': 1, 'b': 1})\n    raise AssertionError('expected ValueError')\nexcept ValueError:\n    pass\nassert invert({1: (1, 2)}) == {(1, 2): 1}\nassert invert({'x': None}) == {None: 'x'}\n",
  "explanation": "A plain comprehension keeps only the last key for a repeated value, losing data silently. Comparing the size of the value set with the dict size detects that case up front."
}
```
