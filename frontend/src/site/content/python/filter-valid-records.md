---
title: Filter Valid Records with a Comprehension
slug: filter-valid-records
difficulty: Easy
description: Use a comprehension to keep records with a positive amount and project selected fields.
topic: python-comprehensions
minutes: 10
---

## Problem

Write `def valid_amounts(rows: list) -> list` that returns `(id, amount)` tuples for rows where
`amount` is present, not `None`, and greater than 0. Keep the input order. Use a list comprehension.

## Examples

```
valid_amounts([{"id": 1, "amount": 10}, {"id": 2, "amount": -5}, {"id": 3}])  ->  [(1, 10)]
```

## Hints

- `row.get('amount')` returns `None` when the key is missing.
- Check `is not None` before comparing with `> 0`.

```task
{
  "id": "filter-valid-records",
  "title": "Filter Valid Records with a Comprehension",
  "type": "python",
  "instructions": "Write `def valid_amounts(rows: list) -> list` that returns `(id, amount)` tuples for rows where\n`amount` is present, not `None`, and greater than 0. Keep the input order. Use a list comprehension.",
  "starter": "def valid_amounts(rows: list) -> list:\n    raise NotImplementedError\n",
  "solution": "def valid_amounts(rows: list) -> list:\n    return [(r[\"id\"], r[\"amount\"]) for r in rows if r.get(\"amount\") is not None and r[\"amount\"] > 0]\n",
  "tests": "assert valid_amounts([{\"id\": 1, \"amount\": 10}, {\"id\": 2, \"amount\": -5}, {\"id\": 3}]) == [(1, 10)]\nassert valid_amounts([]) == []\nassert valid_amounts([{\"id\": 1, \"amount\": None}, {\"id\": 2, \"amount\": 0}]) == []\nassert valid_amounts([{\"id\": 5, \"amount\": 2.5}, {\"id\": 4, \"amount\": 1}]) == [(5, 2.5), (4, 1)]\n"
}
```
