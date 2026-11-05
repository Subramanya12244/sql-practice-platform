---
id: PY-010
title: Normalize Column Names
slug: normalize-column-names
difficulty: Easy
category: processing
skill: cleaning
description: Turn messy CSV header names into clean snake_case column names.
topic: python-fundamentals
concepts: string methods, split/join, snake_case
time: O(n * L)
space: O(n * L)
minutes: 10
---

## Scenario

Spreadsheets uploaded by different teams use headers like ' Order ID ', 'customer-name' and 'Ship.Date'. The loader needs consistent snake_case column names before writing to the warehouse.

## Problem

Write `def normalize_columns(names: list) -> list` that converts each header to snake_case:
strip surrounding whitespace, lowercase, replace any run of spaces, hyphens or dots with a single `_`,
and drop leading/trailing underscores. Order is preserved. An empty list returns `[]`.

## Objective

Convert each header to snake_case by stripping, lowercasing, collapsing spaces, hyphens and dots to single underscores, and trimming underscores.

## Input format

A list of raw column names.

## Output format

A list of snake_case names.

## Constraints

- Hyphens, dots and spaces become single underscores
- No leading/trailing underscores

## Examples

```
normalize_columns([" Order ID", "Customer-Name", "unit.price  "])  ->  ["order_id", "customer_name", "unit_price"]
normalize_columns([])  ->  []
```

## Hints

- `str.strip()` and `str.lower()` handle case and padding.
- Replace `-` and `.` with spaces first, then `'_'.join(s.split())` collapses runs.

## Why it matters

Consistent column names prevent broken queries and duplicate columns downstream, and normalizing them at ingestion is a cheap fix that saves hours later.

```task
{
  "id": "normalize-column-names",
  "title": "Normalize Column Names",
  "type": "python",
  "instructions": "Write `def normalize_columns(names: list) -> list` that converts each header to snake_case:\nstrip surrounding whitespace, lowercase, replace any run of spaces, hyphens or dots with a single `_`,\nand drop leading/trailing underscores. Order is preserved. An empty list returns `[]`.",
  "starter": "def normalize_columns(names: list) -> list:\n    raise NotImplementedError\n",
  "solution": "def normalize_columns(names: list) -> list:\n    out = []\n    for n in names:\n        s = n.strip().lower().replace(\"-\", \" \").replace(\".\", \" \")\n        out.append(\"_\".join(s.split()).strip(\"_\"))\n    return out\n",
  "tests": "assert normalize_columns([\" Order ID\", \"Customer-Name\", \"unit.price  \"]) == [\"order_id\", \"customer_name\", \"unit_price\"]\nassert normalize_columns([]) == []\nassert normalize_columns([\"A  -  B\"]) == [\"a_b\"]\n",
  "hidden": "assert normalize_columns([\"_x_\"]) == [\"x\"]\nassert normalize_columns([\"ID\", \"id\"]) == [\"id\", \"id\"]\n",
  "explanation": "Turning every separator into a space and then using `split()`/`'_'.join` collapses any run of separators into a single underscore; the final strip removes underscores left at the ends."
}
```
