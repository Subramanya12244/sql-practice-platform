---
id: PY-015
title: Parse a CSV String
slug: parse-csv-string
difficulty: Medium
category: files
skill: parsing
description: Parse CSV text with the csv module, casting numeric columns and handling quoted commas.
topic: python-csv-json
concepts: csv module, DictReader, type conversion
time: O(n)
space: O(n)
minutes: 15
---

## Scenario

An inventory API returns a CSV payload as a string, with numeric columns like quantity and some empty cells. The loader needs a list of typed records with empty cells as None.

## Problem

Write `def parse_csv(text: str, int_cols: list) -> list` that parses CSV text (first line is the header)
into a list of dicts using the `csv` module. Values in `int_cols` are cast to `int`; empty strings become
`None` in every column. Blank or `None` input returns `[]`.

## Objective

Parse CSV text into dicts with the csv module, casting int_cols to int and empty strings to None.

## Input format

CSV text and the names of integer columns.

## Output format

A list of dicts.

## Constraints

- Empty cells become None
- Quoted commas must work

## Examples

```
parse_csv('id,name,qty\n1,"Smith, J",3\n2,Lee,\n', ["id", "qty"])
  ->  [{"id": 1, "name": "Smith, J", "qty": 3}, {"id": 2, "name": "Lee", "qty": None}]
```

## Hints

- `csv.DictReader(io.StringIO(text))` handles quotes for you.
- Convert `''` to `None` before casting.

## Why it matters

Turning raw CSV into typed records is the start of nearly every file load, and mapping empty cells to None keeps nulls distinct from zeros.

```task
{
  "id": "parse-csv-string",
  "title": "Parse a CSV String",
  "type": "python",
  "instructions": "Write `def parse_csv(text: str, int_cols: list) -> list` that parses CSV text (first line is the header)\ninto a list of dicts using the `csv` module. Values in `int_cols` are cast to `int`; empty strings become\n`None` in every column. Blank or `None` input returns `[]`.",
  "starter": "def parse_csv(text: str, int_cols: list) -> list:\n    raise NotImplementedError\n",
  "solution": "import csv, io\n\ndef parse_csv(text: str, int_cols: list) -> list:\n    if not text or not text.strip():\n        return []\n    rows = []\n    for r in csv.DictReader(io.StringIO(text)):\n        row = {}\n        for k, v in r.items():\n            if v == \"\":\n                row[k] = None\n            elif k in int_cols:\n                row[k] = int(v)\n            else:\n                row[k] = v\n        rows.append(row)\n    return rows\n",
  "tests": "assert parse_csv('id,name,qty\\n1,\"Smith, J\",3\\n2,Lee,\\n', [\"id\", \"qty\"]) == [{\"id\": 1, \"name\": \"Smith, J\", \"qty\": 3}, {\"id\": 2, \"name\": \"Lee\", \"qty\": None}]\nassert parse_csv(\"\", []) == []\nassert parse_csv(None, []) == []\n",
  "hidden": "assert parse_csv(\"a,b\\n\", [\"a\"]) == []\nassert parse_csv(\"a,b\\n,x\\n\", []) == [{\"a\": None, \"b\": \"x\"}]\n",
  "explanation": "`csv.DictReader` handles quoting rules such as \"Smith, J\" that a naive split breaks, and maps each row to the header. Converting only the listed columns keeps text columns as strings."
}
```
