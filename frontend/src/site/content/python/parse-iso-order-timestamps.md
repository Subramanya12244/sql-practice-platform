---
id: PY-049
title: Parse ISO Order Timestamps
slug: parse-iso-order-timestamps
difficulty: Easy
category: processing
skill: parsing
description: Extract order dates and hours from ISO timestamps in JSON records.
topic: python-modules-packages
concepts: datetime.fromisoformat, error handling
time: O(n)
space: O(n)
minutes: 6
---

## Scenario

An order API returns 'created_at' as ISO 8601 strings. Reporting needs the order date and hour as separate columns.

## Problem

Write `parse_created(records)` returning a list of dicts {'order_id', 'date', 'hour'} where date is 'YYYY-MM-DD' and hour is an int. Skip records whose created_at is missing or not a valid ISO timestamp.

## Objective

Turn each valid ISO created_at value into a date string and an hour, skipping invalid timestamps.

## Input format

A list of dicts with order_id and created_at.

## Output format

A list of dicts.

## Constraints

- Use datetime.fromisoformat

## Examples

```
parse_created([{'order_id': 7, 'created_at': '2024-03-05T14:22:00'}])  ->  [{'order_id': 7, 'date': '2024-03-05', 'hour': 14}]
```

## Hints

- datetime.fromisoformat parses the string.
- Catch ValueError and TypeError and skip.

## Why it matters

Timestamps arrive as strings in nearly every API. Parsing them correctly and dropping bad ones is needed for any time-based partition or report.

```task
{
  "id": "parse-iso-order-timestamps",
  "title": "Parse ISO Order Timestamps",
  "type": "python",
  "instructions": "Write `parse_created(records)` returning a list of dicts {'order_id', 'date', 'hour'} where date is 'YYYY-MM-DD' and hour is an int. Skip records whose created_at is missing or not a valid ISO timestamp.",
  "starter": "def parse_created(records):\n    raise NotImplementedError\n",
  "solution": "from datetime import datetime\n\ndef parse_created(records):\n    out = []\n    for r in records:\n        try:\n            dt = datetime.fromisoformat(r.get('created_at'))\n        except (TypeError, ValueError):\n            continue\n        out.append({'order_id': r['order_id'], 'date': dt.date().isoformat(), 'hour': dt.hour})\n    return out\n",
  "tests": "assert parse_created([{'order_id': 7, 'created_at': '2024-03-05T14:22:00'}]) == [{'order_id': 7, 'date': '2024-03-05', 'hour': 14}]\n",
  "hidden": "assert parse_created([]) == []\nassert parse_created([{'order_id': 1}, {'order_id': 2, 'created_at': 'yesterday'}]) == []\nassert parse_created([{'order_id': 3, 'created_at': '2024-12-31T00:05:00'}]) == [{'order_id': 3, 'date': '2024-12-31', 'hour': 0}]\nassert parse_created([{'order_id': 4, 'created_at': '2024-02-30T10:00:00'}]) == []\n",
  "explanation": "fromisoformat turns the string into a datetime, and invalid dates like Feb 30 raise ValueError. Missing values raise TypeError, so both are skipped."
}
```
