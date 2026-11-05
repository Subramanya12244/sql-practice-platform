---
id: PY-038
title: Find Missing Required Fields
slug: find-missing-required-fields
difficulty: Easy
category: processing
skill: validation
description: Report which required fields each customer record is missing.
topic: python-collections
concepts: set difference, validation
time: O(n*f)
space: O(n)
minutes: 6
---

## Scenario

Before loading a CRM export, the pipeline must list records that lack mandatory fields so the source team can fix them.

## Problem

Write `missing_fields(records, required)` returning a dict mapping each record's 'id' to a sorted list of required fields that are absent, None or an empty string. Records with nothing missing are left out.

## Objective

Map each incomplete record's id to a sorted list of the required fields it lacks.

## Input format

A list of dicts with an 'id' and a list of field names.

## Output format

A dict id -> list of field names.

## Constraints

- Empty string counts as missing

## Examples

```
missing_fields([{'id': 1, 'email': ''}, {'id': 2, 'email': 'a@b.c'}], ['email'])  ->  {1: ['email']}
```

## Hints

- Check r.get(f) in (None, '').
- Only add records whose missing list is non-empty.

## Why it matters

Schema and completeness checks catch bad source data before it pollutes the warehouse. Reporting exactly what is missing makes fixes fast.

```task
{
  "id": "find-missing-required-fields",
  "title": "Find Missing Required Fields",
  "type": "python",
  "instructions": "Write `missing_fields(records, required)` returning a dict mapping each record's 'id' to a sorted list of required fields that are absent, None or an empty string. Records with nothing missing are left out.",
  "starter": "def missing_fields(records, required):\n    raise NotImplementedError\n",
  "solution": "def missing_fields(records, required):\n    out = {}\n    for r in records:\n        miss = sorted(f for f in required if r.get(f) in (None, ''))\n        if miss:\n            out[r['id']] = miss\n    return out\n",
  "tests": "assert missing_fields([{'id': 1, 'email': ''}, {'id': 2, 'email': 'a@b.c'}], ['email']) == {1: ['email']}\n",
  "hidden": "assert missing_fields([], ['a']) == {}\nassert missing_fields([{'id': 1}], ['name', 'email']) == {1: ['email', 'name']}\nassert missing_fields([{'id': 1, 'n': 0}], ['n']) == {}\nassert missing_fields([{'id': 1}], []) == {}\n",
  "explanation": "For each record, required fields that are absent, None or blank are collected. Zero is kept as a valid value because only None and '' count as missing."
}
```
