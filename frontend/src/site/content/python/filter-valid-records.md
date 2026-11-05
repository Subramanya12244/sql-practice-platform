---
id: PY-004
title: Filter Valid Records with a Comprehension
slug: filter-valid-records
difficulty: Easy
category: fundamentals
skill: validation
description: Use a comprehension to keep records with a positive amount and project selected fields.
topic: python-comprehensions
concepts: list comprehensions, dict.get, None handling
time: O(n)
space: O(n)
minutes: 10
---

## Scenario

A payments extract contains transaction rows where amount is sometimes missing, None or a non-positive value from refunds and test entries. The revenue job only wants real positive charges.

## Problem

Write `def valid_amounts(rows: list) -> list` that returns `(id, amount)` tuples for rows where
`amount` is present, not `None`, and greater than 0. Keep the input order. Use a list comprehension.

## Objective

Return (id, amount) tuples for rows whose amount is present, not None and greater than 0, in input order.

## Input format

A list of dicts with 'id' and maybe 'amount'.

## Output format

A list of (id, amount) tuples for positive amounts.

## Constraints

- Missing or None amounts are excluded
- 0 is not positive

## Examples

```
valid_amounts([{"id": 1, "amount": 10}, {"id": 2, "amount": -5}, {"id": 3}])  ->  [(1, 10)]
```

## Hints

- `row.get('amount')` returns `None` when the key is missing.
- Check `is not None` before comparing with `> 0`.

## Why it matters

Filtering out unusable rows before aggregation is a basic data-quality gate, and handling missing keys and None separately avoids KeyErrors on messy input.

```task
{
  "id": "filter-valid-records",
  "title": "Filter Valid Records with a Comprehension",
  "type": "python",
  "instructions": "Write `def valid_amounts(rows: list) -> list` that returns `(id, amount)` tuples for rows where\n`amount` is present, not `None`, and greater than 0. Keep the input order. Use a list comprehension.",
  "starter": "def valid_amounts(rows: list) -> list:\n    raise NotImplementedError\n",
  "solution": "def valid_amounts(rows: list) -> list:\n    return [(r[\"id\"], r[\"amount\"]) for r in rows if r.get(\"amount\") is not None and r[\"amount\"] > 0]\n",
  "tests": "assert valid_amounts([{\"id\": 1, \"amount\": 10}, {\"id\": 2, \"amount\": -5}, {\"id\": 3}]) == [(1, 10)]\nassert valid_amounts([]) == []\n",
  "hidden": "assert valid_amounts([{\"id\": 1, \"amount\": None}, {\"id\": 2, \"amount\": 0}]) == []\nassert valid_amounts([{\"id\": 5, \"amount\": 2.5}, {\"id\": 4, \"amount\": 1}]) == [(5, 2.5), (4, 1)]\n",
  "explanation": "`r.get('amount')` returns None for a missing key instead of raising, and checking `is not None` before `> 0` avoids comparing None with a number, which is a TypeError in Python 3."
}
```
