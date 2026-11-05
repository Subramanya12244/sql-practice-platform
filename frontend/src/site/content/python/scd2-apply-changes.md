---
id: PY-116
title: Apply Changes As A Type-2 Dimension
slug: scd2-apply-changes
difficulty: Hard
category: etl
skill: incremental
description: Maintain history rows with valid_from / valid_to.
topic: python-etl-pipelines
concepts: slowly changing dimensions, versioning, idempotency
time: O(n log n + c)
space: O(n + c)
minutes: 30
---

## Scenario

A customer dimension keeps full history of address and tier changes so past orders report the attributes valid at the time. Each daily batch of changes must close old versions and open new ones.

## Problem

`dimension` rows are dicts {key, attrs, valid_from, valid_to, current}. `changes` are {key, attrs}. For each change: if the key is new, add a current row; if its attrs differ from the current row, close the current row (valid_to = as_of, current False) and add a new current row valid from as_of; if unchanged, do nothing. Return a new list sorted by key then valid_from, leaving inputs unmodified. Applying the same changes twice must not add rows.

## Objective

Apply changes as SCD Type 2, closing changed current rows and adding new versions, returning a new sorted list idempotently.

## Input format

Rows, changes and an ISO date.

## Output format

A new list of rows.

## Constraints

- Idempotent
- Inputs unchanged

## Examples

```
apply_scd2([], [{'key': 1, 'attrs': {'city': 'Oslo'}}], '2024-01-01')  ->  [{'key': 1, 'attrs': {'city': 'Oslo'}, 'valid_from': '2024-01-01', 'valid_to': None, 'current': True}]
```

## Hints

- Copy rows first (copy.deepcopy).
- Index current rows by key to find what each change compares against.

## Why it matters

Slowly changing dimensions are a core warehouse pattern, and implementing one shows exactly how history is preserved and why idempotency matters.

```task
{
  "id": "scd2-apply-changes",
  "title": "Apply Changes As A Type-2 Dimension",
  "type": "python",
  "instructions": "`dimension` rows are dicts {key, attrs, valid_from, valid_to, current}. `changes` are {key, attrs}. For each change: if the key is new, add a current row; if its attrs differ from the current row, close the current row (valid_to = as_of, current False) and add a new current row valid from as_of; if unchanged, do nothing. Return a new list sorted by key then valid_from, leaving inputs unmodified. Applying the same changes twice must not add rows.",
  "starter": "def apply_scd2(dimension: list, changes: list, as_of: str) -> list:\n    raise NotImplementedError\n",
  "solution": "import copy\n\n\ndef apply_scd2(dimension: list, changes: list, as_of: str) -> list:\n    rows = copy.deepcopy(dimension)\n    current = {r['key']: r for r in rows if r['current']}\n    for ch in changes:\n        cur = current.get(ch['key'])\n        if cur is not None and cur['attrs'] == ch['attrs']:\n            continue\n        if cur is not None:\n            cur['valid_to'] = as_of\n            cur['current'] = False\n        new = {'key': ch['key'], 'attrs': copy.deepcopy(ch['attrs']), 'valid_from': as_of, 'valid_to': None, 'current': True}\n        rows.append(new)\n        current[ch['key']] = new\n    return sorted(rows, key=lambda r: (r['key'], r['valid_from'], not r['current']))\n",
  "tests": "r = apply_scd2([], [{'key': 1, 'attrs': {'city': 'Oslo'}}], '2024-01-01')\nassert r == [{'key': 1, 'attrs': {'city': 'Oslo'}, 'valid_from': '2024-01-01', 'valid_to': None, 'current': True}]\n",
  "hidden": "d1 = apply_scd2([], [{'key': 1, 'attrs': {'city': 'Oslo'}}, {'key': 2, 'attrs': {'city': 'Rome'}}], '2024-01-01')\nd2 = apply_scd2(d1, [{'key': 1, 'attrs': {'city': 'Bergen'}}, {'key': 2, 'attrs': {'city': 'Rome'}}], '2024-02-01')\nassert [(r['key'], r['attrs']['city'], r['valid_from'], r['valid_to'], r['current']) for r in d2] == [(1, 'Oslo', '2024-01-01', '2024-02-01', False), (1, 'Bergen', '2024-02-01', None, True), (2, 'Rome', '2024-01-01', None, True)]\nassert d1[0]['current'] is True\nd3 = apply_scd2(d2, [{'key': 1, 'attrs': {'city': 'Bergen'}}], '2024-03-01')\nassert d3 == d2\nchanges = [{'key': 9, 'attrs': {'a': 1}}]\nd4 = apply_scd2([], changes, '2024-01-01')\nd4[0]['attrs']['a'] = 99\nassert changes[0]['attrs']['a'] == 1\n",
  "explanation": "A type-2 dimension never overwrites history: a change closes the current version and opens a new one. Comparing with the current version first makes re-running the same batch a no-op, which is what idempotent loads need. Deep copies keep inputs untouched."
}
```
