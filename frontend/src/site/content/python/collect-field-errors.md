---
id: PY-068
title: Collect All Field Errors Per Record
slug: collect-field-errors
difficulty: Medium
category: fundamentals
skill: validation
description: Run per-field validator functions and collect every error instead of stopping at the first.
topic: python-exceptions
concepts: try/except, error aggregation, validators dict
time: O(n*f)
space: O(n)
minutes: 15
---

## Scenario

A product feed is rejected by the catalogue team. They want a full list of what is wrong with each row, not only the first problem.

## Problem

Write collect_errors(records, validators). validators maps field name to a function that raises ValueError (with a message) on bad input. For each record (index i), run every validator on record.get(field). Missing fields are passed as None. Return a dict {i: ['field: message', ...]} only for records with errors, messages ordered by field name.

## Objective

Use exception handling to aggregate many validation failures.

## Input format

records: list of dicts; validators: dict of callables.

## Output format

dict of index to list of strings.

## Constraints

- Only ValueError is caught
- Valid records are not in the output

## Examples

```
validators={'price': positive}  records=[{'price':5},{'price':-1}]  ->  {1: ['price: must be positive']}
```

## Hints

- Loop over sorted(validators) so messages come out ordered.
- Use str(e) to get the exception message.

## Why it matters

Data quality reports need every failure per row so producers can fix feeds in one pass. Catching and recording exceptions instead of crashing is the core pattern.

```task
{
  "id": "collect-field-errors",
  "title": "Collect All Field Errors Per Record",
  "type": "python",
  "instructions": "Write collect_errors(records, validators). validators maps field name to a function that raises ValueError (with a message) on bad input. For each record (index i), run every validator on record.get(field). Missing fields are passed as None. Return a dict {i: ['field: message', ...]} only for records with errors, messages ordered by field name.",
  "starter": "def collect_errors(records: list, validators: dict) -> dict:\n    raise NotImplementedError\n",
  "solution": "def collect_errors(records: list, validators: dict) -> dict:\n    out = {}\n    for i, rec in enumerate(records):\n        errs = []\n        for field in sorted(validators):\n            try:\n                validators[field](rec.get(field))\n            except ValueError as e:\n                errs.append(f'{field}: {e}')\n        if errs:\n            out[i] = errs\n    return out\n",
  "tests": "def positive(v):\n    if v is None or v <= 0:\n        raise ValueError('must be positive')\ndef sku(v):\n    if not v:\n        raise ValueError('required')\nassert collect_errors([{'price':5,'sku':'A'},{'price':-1}], {'price':positive,'sku':sku}) == {1: ['price: must be positive','sku: required']}\nassert collect_errors([{'price':1,'sku':'B'}], {'price':positive,'sku':sku}) == {}\n",
  "hidden": "def positive(v):\n    if v is None or v <= 0:\n        raise ValueError('must be positive')\nassert collect_errors([], {'p':positive}) == {}\nassert collect_errors([{}], {'p':positive}) == {0:['p: must be positive']}\nassert collect_errors([{'a':1}], {}) == {}\nrecs=[{'p':i-50} for i in range(100)]\nassert len(collect_errors(recs,{'p':positive})) == 51\ndef t(v):\n    raise TypeError('x')\ntry:\n    collect_errors([{'p':1}],{'p':t}); assert False\nexcept TypeError:\n    pass\n",
  "explanation": "Each validator is wrapped in its own try block, so one failure does not stop the remaining checks. Only ValueError is caught, which means real bugs like TypeError still surface. Iterating sorted field names keeps messages deterministic. Records with no errors are omitted to keep the report small."
}
```
