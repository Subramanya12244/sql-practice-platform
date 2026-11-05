---
id: PY-061
title: Sum Valid Payment Amounts
slug: sum-valid-payment-amounts
difficulty: Easy
category: fundamentals
skill: validation
description: Sum payment amounts from raw strings and count rejects.
topic: python-exceptions
concepts: try/except, float conversion, counters
time: O(n)
space: O(1)
minutes: 6
---

## Scenario

A payment provider sends amounts as strings, and some are garbage like 'N/A'. Finance wants the total and how many were rejected.

## Problem

Write `sum_payments(raw)` returning a tuple (total, rejected) where total is the sum of values that parse as float (rounded to 2 decimals) and rejected is how many values failed to parse.

## Objective

Return the rounded total of parseable payment amounts together with the count of rejected values.

## Input format

A list of strings or None.

## Output format

A tuple (float, int).

## Constraints

- None counts as rejected

## Examples

```
sum_payments(['10.5', 'N/A', '4'])  ->  (14.5, 1)
```

## Hints

- Wrap float(v) in try/except.
- Catch both ValueError and TypeError.

## Why it matters

Real feeds always contain bad values. Catching specific exceptions and counting rejects lets a pipeline keep running while still reporting data quality.

```task
{
  "id": "sum-valid-payment-amounts",
  "title": "Sum Valid Payment Amounts",
  "type": "python",
  "instructions": "Write `sum_payments(raw)` returning a tuple (total, rejected) where total is the sum of values that parse as float (rounded to 2 decimals) and rejected is how many values failed to parse.",
  "starter": "def sum_payments(raw):\n    raise NotImplementedError\n",
  "solution": "def sum_payments(raw):\n    total, rejected = 0.0, 0\n    for v in raw:\n        try:\n            total += float(v)\n        except (TypeError, ValueError):\n            rejected += 1\n    return (round(total, 2), rejected)\n",
  "tests": "assert sum_payments(['10.5', 'N/A', '4']) == (14.5, 1)\nassert sum_payments(['1', '2']) == (3.0, 0)\n",
  "hidden": "assert sum_payments([]) == (0.0, 0)\nassert sum_payments([None, '', 'x']) == (0.0, 3)\nassert sum_payments([' 2.25 ', '-1']) == (1.25, 0)\nassert sum_payments(['0.1'] * 10) == (1.0, 0)\n",
  "explanation": "Each value is converted inside try, so failures only bump the rejected counter. Catching TypeError covers None and ValueError covers text that is not a number."
}
```
