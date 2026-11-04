---
title: Normalize Column Names
slug: normalize-column-names
difficulty: Easy
description: Turn messy CSV header names into clean snake_case column names.
topic: python-fundamentals
minutes: 10
---

## Problem

Write `def normalize_columns(names: list) -> list` that converts each header to snake_case:
strip surrounding whitespace, lowercase, replace any run of spaces, hyphens or dots with a single `_`,
and drop leading/trailing underscores. Order is preserved. An empty list returns `[]`.

## Examples

```
normalize_columns([" Order ID", "Customer-Name", "unit.price  "])  ->  ["order_id", "customer_name", "unit_price"]
normalize_columns([])  ->  []
```

## Hints

- `str.strip()` and `str.lower()` handle case and padding.
- Replace `-` and `.` with spaces first, then `'_'.join(s.split())` collapses runs.

```task
{
  "id": "normalize-column-names",
  "title": "Normalize Column Names",
  "type": "python",
  "instructions": "Write `def normalize_columns(names: list) -> list` that converts each header to snake_case:\nstrip surrounding whitespace, lowercase, replace any run of spaces, hyphens or dots with a single `_`,\nand drop leading/trailing underscores. Order is preserved. An empty list returns `[]`.",
  "starter": "def normalize_columns(names: list) -> list:\n    raise NotImplementedError\n",
  "solution": "def normalize_columns(names: list) -> list:\n    out = []\n    for n in names:\n        s = n.strip().lower().replace(\"-\", \" \").replace(\".\", \" \")\n        out.append(\"_\".join(s.split()).strip(\"_\"))\n    return out\n",
  "tests": "assert normalize_columns([\" Order ID\", \"Customer-Name\", \"unit.price  \"]) == [\"order_id\", \"customer_name\", \"unit_price\"]\nassert normalize_columns([]) == []\nassert normalize_columns([\"A  -  B\"]) == [\"a_b\"]\nassert normalize_columns([\"_x_\"]) == [\"x\"]\nassert normalize_columns([\"ID\", \"id\"]) == [\"id\", \"id\"]\n"
}
```
