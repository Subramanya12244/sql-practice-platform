---
id: PY-024
title: Cast Records to a Schema
slug: cast-record-schema
difficulty: Easy
category: processing
skill: validation
description: Convert string fields in CSV rows to typed values using a schema.
topic: python-variables-data-types
concepts: type conversion, schema dicts, try/except
time: O(n*f)
space: O(n)
minutes: 8
---

## Scenario

CSV rows arrive with every value as a string. The load step needs ints and floats per a schema, and rows that don't fit must be rejected.

## Problem

Write `cast_rows(rows, schema)` where schema maps field to a type (int, float or str). Return (good, bad_count): good is a list of converted dicts with only schema fields; a row is bad if any schema field is missing or fails conversion.

## Objective

Cast each row's fields to the schema types and return the good rows plus a count of rejected rows.

## Input format

A list of dicts of strings and a schema dict.

## Output format

A tuple (list, int).

## Constraints

- Extra fields are dropped

## Examples

```
cast_rows([{'id': '1', 'amt': '2.5'}, {'id': 'x', 'amt': '1'}], {'id': int, 'amt': float})  ->  ([{'id': 1, 'amt': 2.5}], 1)
```

## Hints

- Call the type as a function: int('5').
- Catch KeyError, ValueError and TypeError for the whole row.

## Why it matters

Type casting against a schema is what every loader does before writing to a typed table. Rejecting whole rows keeps partial garbage out.

```task
{
  "id": "cast-record-schema",
  "title": "Cast Records to a Schema",
  "type": "python",
  "instructions": "Write `cast_rows(rows, schema)` where schema maps field to a type (int, float or str). Return (good, bad_count): good is a list of converted dicts with only schema fields; a row is bad if any schema field is missing or fails conversion.",
  "starter": "def cast_rows(rows, schema):\n    raise NotImplementedError\n",
  "solution": "def cast_rows(rows, schema):\n    good, bad = [], 0\n    for r in rows:\n        try:\n            good.append({f: t(r[f]) for f, t in schema.items()})\n        except (KeyError, ValueError, TypeError):\n            bad += 1\n    return good, bad\n",
  "tests": "assert cast_rows([{'id': '1', 'amt': '2.5'}, {'id': 'x', 'amt': '1'}], {'id': int, 'amt': float}) == ([{'id': 1, 'amt': 2.5}], 1)\n",
  "hidden": "assert cast_rows([], {'a': int}) == ([], 0)\nassert cast_rows([{'a': '1', 'z': 'q'}], {'a': int}) == ([{'a': 1}], 0)\nassert cast_rows([{'b': '1'}], {'a': int}) == ([], 1)\nassert cast_rows([{'a': None}], {'a': int}) == ([], 1)\nassert cast_rows([{'n': 'Bob'}], {'n': str}) == ([{'n': 'Bob'}], 0)\n",
  "explanation": "Each row is converted in one comprehension inside try, so any failure rejects the whole row. Only schema fields are copied, which drops extras."
}
```
