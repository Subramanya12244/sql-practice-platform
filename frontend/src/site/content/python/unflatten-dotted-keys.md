---
id: PY-111
title: Unflatten Dotted Keys
slug: unflatten-dotted-keys
difficulty: Medium
category: processing
skill: transformation
description: Turn {'a.b': 1} back into {'a': {'b': 1}}.
topic: python-csv-json
concepts: nested dicts, setdefault, conflicts
time: O(n * d)
space: O(n * d)
minutes: 15
---

## Scenario

A form builder stores customer profile fields as flat dotted keys like 'address.city'. The API that receives them expects nested JSON, and contradictory keys must be rejected.

## Problem

Convert keys like 'user.address.city' into nested dicts. Raise ValueError if a key conflicts with a value already placed (e.g. both 'a' = 1 and 'a.b' = 2).

## Objective

Convert dotted keys into nested dicts, raising ValueError when a key conflicts with a value already placed.

## Input format

A dict with dotted string keys.

## Output format

A nested dict.

## Constraints

- Conflicts raise ValueError

## Examples

```
unflatten({'a.b': 1, 'a.c': 2, 'd': 3})  ->  {'a': {'b': 1, 'c': 2}, 'd': 3}
```

## Hints

- Split each key and walk with setdefault(part, {}).
- Check that each step is a dict before descending.

## Why it matters

Rebuilding nested payloads from flat columns is the reverse of loading, needed when publishing warehouse data back to APIs.

```task
{
  "id": "unflatten-dotted-keys",
  "title": "Unflatten Dotted Keys",
  "type": "python",
  "instructions": "Convert keys like 'user.address.city' into nested dicts. Raise ValueError if a key conflicts with a value already placed (e.g. both 'a' = 1 and 'a.b' = 2).",
  "starter": "def unflatten(flat: dict) -> dict:\n    raise NotImplementedError\n",
  "solution": "def unflatten(flat: dict) -> dict:\n    out = {}\n    for key, value in flat.items():\n        parts = key.split('.')\n        node = out\n        for p in parts[:-1]:\n            node = node.setdefault(p, {})\n            if not isinstance(node, dict):\n                raise ValueError(f'conflict at {key}')\n        if parts[-1] in node and isinstance(node[parts[-1]], dict):\n            raise ValueError(f'conflict at {key}')\n        node[parts[-1]] = value\n    return out\n",
  "tests": "assert unflatten({'a.b': 1, 'a.c': 2, 'd': 3}) == {'a': {'b': 1, 'c': 2}, 'd': 3}\n",
  "hidden": "assert unflatten({}) == {}\nassert unflatten({'x.y.z': None}) == {'x': {'y': {'z': None}}}\ntry:\n    unflatten({'a': 1, 'a.b': 2})\n    raise AssertionError('expected ValueError')\nexcept ValueError:\n    pass\ntry:\n    unflatten({'a.b': 2, 'a': 1})\n    raise AssertionError('expected ValueError')\nexcept ValueError:\n    pass\n",
  "explanation": "`setdefault` creates intermediate dicts on first use. Both orders of a conflicting pair are caught: descending into a non-dict, or overwriting a dict with a plain value."
}
```
