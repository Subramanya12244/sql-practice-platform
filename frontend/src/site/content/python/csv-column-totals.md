---
id: PY-071
title: CSV Column Totals
slug: csv-column-totals
difficulty: Medium
category: files
skill: parsing
description: Read CSV text and total its numeric columns.
topic: python-csv-json
concepts: csv module, DictReader, numeric validation
time: O(r * c)
space: O(r * c)
minutes: 15
---

## Scenario

A finance team uploads CSV exports whose columns mix numeric amounts with text like region names. The control report needs totals only for the columns that are entirely numeric.

## Problem

Parse CSV text with a header row. Return a dict of column → total for columns where every non-empty value is numeric (int or float); empty cells count as 0. Ignore other columns. Totals are rounded to 2 dp.

## Objective

Return totals rounded to 2 dp for every CSV column whose non-empty values are all numeric, treating empty cells as 0.

## Input format

CSV text.

## Output format

A dict.

## Constraints

- Use the csv module (quoted commas must work)

## Examples

```
column_totals('a,b,c\n1,x,2.5\n3,y,\n')  ->  {'a': 4, 'c': 2.5}
```

## Hints

- `csv.DictReader(io.StringIO(text))`.
- Try float() on each value; a failure disqualifies the column.

## Why it matters

Profiling CSV columns by type is the first step of loading untrusted files, and the csv module handles quoting that naive splitting gets wrong.

```task
{
  "id": "csv-column-totals",
  "title": "CSV Column Totals",
  "type": "python",
  "instructions": "Parse CSV text with a header row. Return a dict of column → total for columns where every non-empty value is numeric (int or float); empty cells count as 0. Ignore other columns. Totals are rounded to 2 dp.",
  "starter": "def column_totals(csv_text: str) -> dict:\n    raise NotImplementedError\n",
  "solution": "import csv\nimport io\n\n\ndef column_totals(csv_text: str) -> dict:\n    rows = list(csv.DictReader(io.StringIO(csv_text)))\n    if not rows:\n        return {}\n    out = {}\n    for col in rows[0].keys():\n        total, ok = 0.0, True\n        for r in rows:\n            v = (r[col] or '').strip()\n            if not v:\n                continue\n            try:\n                total += float(v)\n            except ValueError:\n                ok = False\n                break\n        if ok:\n            out[col] = int(total) if total.is_integer() else round(total, 2)\n    return out\n",
  "tests": "assert column_totals('a,b,c\\n1,x,2.5\\n3,y,\\n') == {'a': 4, 'c': 2.5}\n",
  "hidden": "assert column_totals('') == {}\nassert column_totals('a\\n') == {}\nassert column_totals('name,amount\\n\"Smith, J\",10\\n\"Lee, K\",5.25\\n') == {'amount': 15.25}\nassert column_totals('q\\n-1\\n1\\n') == {'q': 0}\n",
  "explanation": "The csv module handles quoted fields such as \"Smith, J\" that a naive split(',') breaks. A column is numeric only if every non-empty value parses, so one text value excludes it."
}
```
