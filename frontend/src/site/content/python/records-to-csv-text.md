---
id: PY-053
title: Records to CSV Text
slug: records-to-csv-text
difficulty: Easy
category: files
skill: transformation
description: Serialise a list of employee dicts to CSV text with a header.
topic: python-csv-json
concepts: csv.DictWriter, io.StringIO
time: O(n)
space: O(n)
minutes: 6
---

## Scenario

An HR API returns employees as JSON, and the payroll vendor only accepts CSV uploads.

## Problem

Write `to_csv(records, fields)` returning CSV text with a header row of fields and one line per record, using '\n' line endings. Missing fields are written as empty. Extra keys are ignored.

## Objective

Serialise the records to header-first CSV text in the given field order.

## Input format

A list of dicts and a list of field names.

## Output format

A CSV string.

## Constraints

- Use csv.DictWriter

## Examples

```
to_csv([{'id': 1, 'name': 'Ana'}], ['id', 'name'])  ->  'id,name\n1,Ana\n'
```

## Hints

- Write into io.StringIO.
- DictWriter takes lineterminator and extrasaction arguments.

## Why it matters

Converting JSON to CSV is a frequent hand-off format. Using the csv module handles quoting of commas and quotes correctly.

```task
{
  "id": "records-to-csv-text",
  "title": "Records to CSV Text",
  "type": "python",
  "instructions": "Write `to_csv(records, fields)` returning CSV text with a header row of fields and one line per record, using '\\n' line endings. Missing fields are written as empty. Extra keys are ignored.",
  "starter": "def to_csv(records, fields):\n    raise NotImplementedError\n",
  "solution": "import csv, io\n\ndef to_csv(records, fields):\n    buf = io.StringIO()\n    w = csv.DictWriter(buf, fieldnames=fields, lineterminator='\\n', extrasaction='ignore')\n    w.writeheader()\n    w.writerows(records)\n    return buf.getvalue()\n",
  "tests": "assert to_csv([{'id': 1, 'name': 'Ana'}], ['id', 'name']) == 'id,name\\n1,Ana\\n'\n",
  "hidden": "assert to_csv([], ['a']) == 'a\\n'\nassert to_csv([{'a': 'x,y'}], ['a']) == 'a\\n\"x,y\"\\n'\nassert to_csv([{'a': 1, 'z': 9}], ['a', 'b']) == 'a,b\\n1,\\n'\n",
  "explanation": "DictWriter writes the header and rows in field order and quotes values that contain commas. extrasaction='ignore' drops unknown keys and missing ones become empty."
}
```
