---
id: PY-143
title: Reconcile Two Data Sources
slug: reconcile-sources
difficulty: Hard
category: etl
skill: validation
description: Compare source and target records by key and report differences.
topic: python-etl-pipelines
concepts: set operations, field-level diffs, reporting
time: O(n log n)
space: O(n)
minutes: 25
---

## Scenario

After migrating customer records from a legacy CRM to a new one, the team must prove both systems agree. They need the keys missing on each side and the exact field differences for shared keys.

## Problem

Return {'missing': keys in source not in target, 'extra': keys in target not in source, 'changed': {key: {field: (source_value, target_value)}}} for keys in both whose other fields differ (fields present in either side; a missing field counts as None). Key lists are sorted. Raise ValueError if a side contains a duplicate key.

## Objective

Return missing keys, extra keys and per-field changes between source and target, raising ValueError on duplicate keys.

## Input format

Two lists of dicts and the key field name.

## Output format

A dict report.

## Constraints

- Duplicate keys raise ValueError

## Examples

```
reconcile([{'id': 1, 'v': 5}], [{'id': 1, 'v': 6}, {'id': 2, 'v': 1}], 'id')  ->  {'missing': [], 'extra': [2], 'changed': {1: {'v': (5, 6)}}}
```

## Hints

- Index each side by key, checking for duplicates.
- Compare the union of field names for keys present on both sides.

## Why it matters

Reconciliation is how you prove a load or migration is correct, and field-level diffs turn 'counts don't match' into an actionable list.

```task
{
  "id": "reconcile-sources",
  "title": "Reconcile Two Data Sources",
  "type": "python",
  "instructions": "Return {'missing': keys in source not in target, 'extra': keys in target not in source, 'changed': {key: {field: (source_value, target_value)}}} for keys in both whose other fields differ (fields present in either side; a missing field counts as None). Key lists are sorted. Raise ValueError if a side contains a duplicate key.",
  "starter": "def reconcile(source: list, target: list, key: str) -> dict:\n    raise NotImplementedError\n",
  "solution": "def _index(rows: list, key: str) -> dict:\n    out = {}\n    for r in rows:\n        if r[key] in out:\n            raise ValueError(f'duplicate key {r[key]!r}')\n        out[r[key]] = r\n    return out\n\n\ndef reconcile(source: list, target: list, key: str) -> dict:\n    s, t = _index(source, key), _index(target, key)\n    changed = {}\n    for k in sorted(s.keys() & t.keys()):\n        fields = (s[k].keys() | t[k].keys()) - {key}\n        diff = {f: (s[k].get(f), t[k].get(f)) for f in sorted(fields) if s[k].get(f) != t[k].get(f)}\n        if diff:\n            changed[k] = diff\n    return {'missing': sorted(s.keys() - t.keys()), 'extra': sorted(t.keys() - s.keys()), 'changed': changed}\n",
  "tests": "assert reconcile([{'id': 1, 'v': 5}], [{'id': 1, 'v': 6}, {'id': 2, 'v': 1}], 'id') == {'missing': [], 'extra': [2], 'changed': {1: {'v': (5, 6)}}}\n",
  "hidden": "assert reconcile([], [], 'id') == {'missing': [], 'extra': [], 'changed': {}}\nr = reconcile([{'id': 'a', 'x': 1, 'y': 2}, {'id': 'b'}], [{'id': 'a', 'x': 1, 'z': 3}], 'id')\nassert r == {'missing': ['b'], 'extra': [], 'changed': {'a': {'y': (2, None), 'z': (None, 3)}}}\nassert reconcile([{'id': 1, 'v': None}], [{'id': 1}], 'id')['changed'] == {}\ntry:\n    reconcile([{'id': 1}, {'id': 1}], [], 'id')\n    raise AssertionError('expected ValueError')\nexcept ValueError:\n    pass\n",
  "explanation": "Indexing each side by key turns matching into set operations: differences give missing and extra keys, the intersection gives pairs to diff. Comparing the union of field names catches columns that exist on only one side."
}
```
