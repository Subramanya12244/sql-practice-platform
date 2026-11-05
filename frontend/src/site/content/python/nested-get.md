---
id: PY-056
title: Safe Nested Lookup
slug: nested-get
difficulty: Easy
category: fundamentals
skill: parsing
description: Read a value from nested dicts with a dotted path.
topic: python-collections
concepts: dicts, loops, default values
time: O(d)
space: O(1)
minutes: 8
---

## Scenario

A customer API returns deeply nested JSON profiles, and fields like the city are often missing or null for some users. The loader must read 'user.address.city' without crashing on incomplete profiles.

## Problem

Return the value at a dotted `path` such as 'user.address.city' in nested dicts, or `default` if any key is missing or a step isn't a dict.

## Objective

Return the value at a dotted path in nested dicts, or the default when any step is missing or not a dict.

## Input format

A nested dict, a dotted path, a default.

## Output format

The value or default.

## Constraints

- Values may legitimately be None or falsy

## Examples

```
get_path({'a': {'b': 1}}, 'a.b')  ->  1
get_path({'a': 1}, 'a.b', 'x')  ->  'x'
```

## Hints

- Split the path on '.', walk one key at a time.
- Check `isinstance(node, dict)` and `key in node` at each step.

## Why it matters

API payloads are inconsistent, and a safe accessor lets an extraction job keep running on partial records instead of failing on the first missing key.

```task
{
  "id": "nested-get",
  "title": "Safe Nested Lookup",
  "type": "python",
  "instructions": "Return the value at a dotted `path` such as 'user.address.city' in nested dicts, or `default` if any key is missing or a step isn't a dict.",
  "starter": "def get_path(data: dict, path: str, default=None):\n    raise NotImplementedError\n",
  "solution": "def get_path(data: dict, path: str, default=None):\n    node = data\n    for key in path.split('.'):\n        if not isinstance(node, dict) or key not in node:\n            return default\n        node = node[key]\n    return node\n",
  "tests": "assert get_path({'a': {'b': 1}}, 'a.b') == 1\nassert get_path({'a': 1}, 'a.b', 'x') == 'x'\n",
  "hidden": "assert get_path({'a': {'b': None}}, 'a.b', 'x') is None\nassert get_path({'a': {'b': 0}}, 'a.b', 9) == 0\nassert get_path({}, 'a') is None\nassert get_path({'a': {'b': {'c': [1]}}}, 'a.b.c') == [1]\n",
  "explanation": "Using `key in node` rather than `node.get(key)` distinguishes a missing key from a key whose value is None or 0, which must be returned as-is."
}
```
