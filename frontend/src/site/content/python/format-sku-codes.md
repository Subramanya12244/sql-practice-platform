---
id: PY-040
title: Format SKU Codes
slug: format-sku-codes
difficulty: Easy
category: fundamentals
skill: cleaning
description: Normalise product SKU numbers into a fixed-width code.
topic: python-variables-data-types
concepts: int conversion, zero padding, string formatting
time: O(n)
space: O(n)
minutes: 5
---

## Scenario

Two inventory systems store SKUs differently: one as ints, one as strings like ' 42 '. The catalog needs codes like 'SKU-00042'.

## Problem

Write `format_skus(values)` that turns each value into 'SKU-' plus the number zero-padded to 5 digits. Skip values that can't be converted to a non-negative int. Keep input order.

## Objective

Turn every convertible SKU value into a zero-padded 'SKU-00000' code and drop the rest.

## Input format

A list of ints or strings.

## Output format

A list of formatted strings.

## Constraints

- Numbers longer than 5 digits are not truncated

## Examples

```
format_skus([42, ' 7 ', 'abc'])  ->  ['SKU-00042', 'SKU-00007']
```

## Hints

- int(' 7 ') works because int strips whitespace.
- Use f'{n:05d}' for padding and try/except for bad values.

## Why it matters

Joining data from systems with different key formats fails unless keys are normalised first. This is the core of key standardisation.

```task
{
  "id": "format-sku-codes",
  "title": "Format SKU Codes",
  "type": "python",
  "instructions": "Write `format_skus(values)` that turns each value into 'SKU-' plus the number zero-padded to 5 digits. Skip values that can't be converted to a non-negative int. Keep input order.",
  "starter": "def format_skus(values):\n    raise NotImplementedError\n",
  "solution": "def format_skus(values):\n    out = []\n    for v in values:\n        try:\n            n = int(v)\n        except (TypeError, ValueError):\n            continue\n        if n >= 0:\n            out.append(f'SKU-{n:05d}')\n    return out\n",
  "tests": "assert format_skus([42, ' 7 ', 'abc']) == ['SKU-00042', 'SKU-00007']\nassert format_skus(['12345']) == ['SKU-12345']\n",
  "hidden": "assert format_skus([]) == []\nassert format_skus([None, -3, '']) == []\nassert format_skus([1234567]) == ['SKU-1234567']\nassert format_skus([0]) == ['SKU-00000']\n",
  "explanation": "int() handles both ints and padded strings, and the except clause drops values that can't parse. The 05d format pads short numbers without cutting long ones."
}
```
