---
id: PY-078
title: Find Duplicates By Composite Key
slug: composite-key-duplicates
difficulty: Medium
category: dsa
skill: deduplication
description: Report groups of transactions that share customer, date and amount.
topic: python-collections
concepts: tuple keys, dict of lists, normalisation
time: O(n log n)
space: O(n)
minutes: 15
---

## Scenario

The payments team suspects a gateway retried charges. Duplicates are rows with the same customer, date and amount, even if ids differ.

## Problem

Write find_duplicates(txns, keys). Build a key tuple from the given field names, lowercasing and stripping string values. Return a list of id lists (each sorted) for keys that occur more than once, ordered by the smallest id in each group.

## Objective

Detect duplicates on a normalised composite key in one pass.

## Input format

txns: list of dicts with 'id'; keys: list of field names.

## Output format

list of lists of ids.

## Constraints

- Missing fields count as None
- Single-occurrence keys are not reported

## Examples

```
[{'id':1,'cust':'A','amt':5},{'id':2,'cust':'a ','amt':5},{'id':3,'cust':'B','amt':5}], ['cust','amt']  ->  [[1, 2]]
```

## Hints

- A tuple of normalised values is hashable and works as a dict key.
- Group ids per key, then keep groups with len > 1.

## Why it matters

Duplicate detection on business keys rather than surrogate ids is a core data quality check. Normalising before hashing avoids missing near-duplicates.

```task
{
  "id": "composite-key-duplicates",
  "title": "Find Duplicates By Composite Key",
  "type": "python",
  "instructions": "Write find_duplicates(txns, keys). Build a key tuple from the given field names, lowercasing and stripping string values. Return a list of id lists (each sorted) for keys that occur more than once, ordered by the smallest id in each group.",
  "starter": "def find_duplicates(txns: list, keys: list) -> list:\n    raise NotImplementedError\n",
  "solution": "def find_duplicates(txns: list, keys: list) -> list:\n    def norm(v):\n        return v.strip().lower() if isinstance(v, str) else v\n    groups = {}\n    for t in txns:\n        k = tuple(norm(t.get(f)) for f in keys)\n        groups.setdefault(k, []).append(t['id'])\n    dups = [sorted(g) for g in groups.values() if len(g) > 1]\n    return sorted(dups, key=lambda g: g[0])\n",
  "tests": "assert find_duplicates([{'id':1,'cust':'A','amt':5},{'id':2,'cust':'a ','amt':5},{'id':3,'cust':'B','amt':5}], ['cust','amt']) == [[1, 2]]\nassert find_duplicates([{'id':1,'cust':'A'}], ['cust']) == []\n",
  "hidden": "assert find_duplicates([], ['a']) == []\nassert find_duplicates([{'id':5},{'id':4}], ['x']) == [[4,5]]\nt=[{'id':9,'c':'x','d':1},{'id':2,'c':'y','d':1},{'id':1,'c':'Y','d':1},{'id':3,'c':'X','d':1}]\nassert find_duplicates(t, ['c','d']) == [[1,2],[3,9]]\nbig=[{'id':i,'c':i%10} for i in range(1000)]\nr=find_duplicates(big,['c'])\nassert len(r)==10 and r[0][:2]==[0,10]\n",
  "explanation": "Each record maps to a normalised tuple key, so equal business keys collide in the dict regardless of case or padding. Grouping is a single O(n) pass. Groups of size one are filtered out, and sorting by the first id makes the report stable."
}
```
