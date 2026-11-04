---
title: Parse a CSV String
slug: parse-csv-string
difficulty: Medium
description: Parse CSV text with the csv module, casting numeric columns and handling quoted commas.
topic: python-csv-json
minutes: 15
---

## Problem

Write `def parse_csv(text: str, int_cols: list) -> list` that parses CSV text (first line is the header)
into a list of dicts using the `csv` module. Values in `int_cols` are cast to `int`; empty strings become
`None` in every column. Blank or `None` input returns `[]`.

## Examples

```
parse_csv('id,name,qty\n1,"Smith, J",3\n2,Lee,\n', ["id", "qty"])
  ->  [{"id": 1, "name": "Smith, J", "qty": 3}, {"id": 2, "name": "Lee", "qty": None}]
```

## Hints

- `csv.DictReader(io.StringIO(text))` handles quotes for you.
- Convert `''` to `None` before casting.

```task
{
  "id": "parse-csv-string",
  "title": "Parse a CSV String",
  "type": "python",
  "instructions": "Write `def parse_csv(text: str, int_cols: list) -> list` that parses CSV text (first line is the header)\ninto a list of dicts using the `csv` module. Values in `int_cols` are cast to `int`; empty strings become\n`None` in every column. Blank or `None` input returns `[]`.",
  "starter": "def parse_csv(text: str, int_cols: list) -> list:\n    raise NotImplementedError\n",
  "solution": "import csv, io\n\ndef parse_csv(text: str, int_cols: list) -> list:\n    if not text or not text.strip():\n        return []\n    rows = []\n    for r in csv.DictReader(io.StringIO(text)):\n        row = {}\n        for k, v in r.items():\n            if v == \"\":\n                row[k] = None\n            elif k in int_cols:\n                row[k] = int(v)\n            else:\n                row[k] = v\n        rows.append(row)\n    return rows\n",
  "tests": "assert parse_csv('id,name,qty\\n1,\"Smith, J\",3\\n2,Lee,\\n', [\"id\", \"qty\"]) == [{\"id\": 1, \"name\": \"Smith, J\", \"qty\": 3}, {\"id\": 2, \"name\": \"Lee\", \"qty\": None}]\nassert parse_csv(\"\", []) == []\nassert parse_csv(None, []) == []\nassert parse_csv(\"a,b\\n\", [\"a\"]) == []\nassert parse_csv(\"a,b\\n,x\\n\", []) == [{\"a\": None, \"b\": \"x\"}]\n"
}
```
