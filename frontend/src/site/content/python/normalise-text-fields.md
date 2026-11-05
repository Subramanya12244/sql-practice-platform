---
id: PY-047
title: Normalise Text Fields
slug: normalise-text-fields
difficulty: Easy
category: processing
skill: cleaning
description: Trim and lowercase string values in customer records.
topic: python-comprehensions
concepts: dict comprehension, isinstance, strip/lower
time: O(n*f)
space: O(n)
minutes: 5
---

## Scenario

Customer records from a web form have values like '  ALICE@Mail.COM '. Matching fails unless text is trimmed and lowercased.

## Problem

Write `normalise(records)` returning new dicts where every string value is stripped and lowercased, and strings that become empty are replaced with None. Non-string values are unchanged.

## Objective

Return copies of the records with every string trimmed and lowercased, and blank strings set to None.

## Input format

A list of dicts.

## Output format

A list of new dicts.

## Constraints

- Keys are unchanged

## Examples

```
normalise([{'email': '  A@B.COM ', 'age': 30, 'city': '  '}])  ->  [{'email': 'a@b.com', 'age': 30, 'city': None}]
```

## Hints

- Write a small helper for a single value.
- Use a nested comprehension to rebuild each dict.

## Why it matters

Whitespace and case differences are the top cause of failed joins and duplicate customers. A normalisation step fixes them before matching.

```task
{
  "id": "normalise-text-fields",
  "title": "Normalise Text Fields",
  "type": "python",
  "instructions": "Write `normalise(records)` returning new dicts where every string value is stripped and lowercased, and strings that become empty are replaced with None. Non-string values are unchanged.",
  "starter": "def normalise(records):\n    raise NotImplementedError\n",
  "solution": "def _clean(v):\n    if isinstance(v, str):\n        v = v.strip().lower()\n        return v or None\n    return v\n\ndef normalise(records):\n    return [{k: _clean(v) for k, v in r.items()} for r in records]\n",
  "tests": "assert normalise([{'email': '  A@B.COM ', 'age': 30, 'city': '  '}]) == [{'email': 'a@b.com', 'age': 30, 'city': None}]\n",
  "hidden": "assert normalise([]) == []\nassert normalise([{'a': None, 'b': 0}]) == [{'a': None, 'b': 0}]\nsrc = [{'n': ' X '}]\nnormalise(src)\nassert src == [{'n': ' X '}]\nassert normalise([{'t': '\\tHi\\n'}]) == [{'t': 'hi'}]\n",
  "explanation": "The helper cleans one value and maps blank strings to None. The comprehension builds new dicts, so the original records stay unchanged."
}
```
