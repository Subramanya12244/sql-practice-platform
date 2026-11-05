---
id: PY-073
title: Deep Merge Two Dictionaries
slug: deep-merge-dicts
difficulty: Medium
category: fundamentals
skill: transformation
description: Recursively merge nested config dicts.
topic: python-functions
concepts: recursion, dict copies, precedence
time: O(n)
space: O(n)
minutes: 15
---

## Scenario

A pipeline has a base config shared by all environments and a smaller override for production that changes only a few nested settings. The effective config must combine both without altering the originals.

## Problem

Return a new dict combining `base` and `override`. When both have a dict at the same key, merge them recursively; otherwise the override value wins. Inputs must not be modified.

## Objective

Return a new dict that recursively merges override into base, with override values winning on conflicts.

## Input format

Two nested dicts.

## Output format

A new dict.

## Constraints

- Lists are replaced, not merged

## Examples

```
deep_merge({'db': {'host': 'a', 'port': 1}}, {'db': {'port': 2}})  ->  {'db': {'host': 'a', 'port': 2}}
```

## Hints

- Copy base, then loop over override.
- Recurse only when both sides are dicts.

## Why it matters

Layered configuration is how most pipelines are deployed across dev, staging and prod, and a non-mutating merge avoids settings leaking between runs.

```task
{
  "id": "deep-merge-dicts",
  "title": "Deep Merge Two Dictionaries",
  "type": "python",
  "instructions": "Return a new dict combining `base` and `override`. When both have a dict at the same key, merge them recursively; otherwise the override value wins. Inputs must not be modified.",
  "starter": "def deep_merge(base: dict, override: dict) -> dict:\n    raise NotImplementedError\n",
  "solution": "import copy\n\n\ndef deep_merge(base: dict, override: dict) -> dict:\n    out = copy.deepcopy(base)\n    for k, v in override.items():\n        if isinstance(out.get(k), dict) and isinstance(v, dict):\n            out[k] = deep_merge(out[k], v)\n        else:\n            out[k] = copy.deepcopy(v)\n    return out\n",
  "tests": "assert deep_merge({'db': {'host': 'a', 'port': 1}}, {'db': {'port': 2}}) == {'db': {'host': 'a', 'port': 2}}\n",
  "hidden": "a = {'x': {'y': {'z': 1}}, 'l': [1]}\nb = {'x': {'y': {'w': 2}}, 'l': [2]}\nr = deep_merge(a, b)\nassert r == {'x': {'y': {'z': 1, 'w': 2}}, 'l': [2]}\nassert a == {'x': {'y': {'z': 1}}, 'l': [1]}\nr['x']['y']['z'] = 99\nassert a['x']['y']['z'] == 1\nassert deep_merge({'k': {'a': 1}}, {'k': 5}) == {'k': 5}\nassert deep_merge({}, {}) == {}\n",
  "explanation": "Deep-copying prevents the result sharing nested dicts with the inputs, which would let later edits leak back. Recursion applies the same rule at every level."
}
```
