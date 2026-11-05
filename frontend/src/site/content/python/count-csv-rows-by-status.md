---
id: PY-029
title: Count CSV Rows by Status
slug: count-csv-rows-by-status
difficulty: Easy
category: files
skill: aggregation
description: Read an orders CSV file and count orders per status.
topic: python-csv-json
concepts: csv.DictReader, Counter
time: O(n)
space: O(k)
minutes: 6
---

## Scenario

Operations receives an orders.csv export each hour and wants a count of orders per status to spot stuck shipments.

## Problem

Write `status_counts(path)` that reads a CSV file with a header containing 'status' and returns a dict of status -> count. Strip and lowercase status values; blank status counts as 'unknown'.

## Objective

Read the orders CSV and count rows per normalised status, using 'unknown' for blanks.

## Input format

A CSV file path.

## Output format

A dict.

## Constraints

- Use csv.DictReader

## Examples

```
rows status: 'shipped', ' Shipped', 'pending'  ->  {'shipped': 2, 'pending': 1}
```

## Hints

- Open with newline='' for the csv module.
- row.get('status') or '' then strip/lower.

## Why it matters

Reading CSV with a header and aggregating a column is the bread and butter of file ingestion. Normalising values before counting avoids split categories.

```task
{
  "id": "count-csv-rows-by-status",
  "title": "Count CSV Rows by Status",
  "type": "python",
  "instructions": "Write `status_counts(path)` that reads a CSV file with a header containing 'status' and returns a dict of status -> count. Strip and lowercase status values; blank status counts as 'unknown'.",
  "starter": "def status_counts(path):\n    raise NotImplementedError\n",
  "solution": "import csv\n\ndef status_counts(path):\n    counts = {}\n    with open(path, newline='') as f:\n        for row in csv.DictReader(f):\n            s = (row.get('status') or '').strip().lower() or 'unknown'\n            counts[s] = counts.get(s, 0) + 1\n    return counts\n",
  "tests": "with open('orders.csv', 'w') as f:\n    f.write('id,status\\n1,shipped\\n2, Shipped\\n3,pending\\n')\nassert status_counts('orders.csv') == {'shipped': 2, 'pending': 1}\n",
  "hidden": "with open('h.csv', 'w') as f:\n    f.write('id,status\\n')\nassert status_counts('h.csv') == {}\nwith open('u.csv', 'w') as f:\n    f.write('id,status\\n1,\\n2,  \\n3,NEW\\n')\nassert status_counts('u.csv') == {'unknown': 2, 'new': 1}\nwith open('big.csv', 'w') as f:\n    f.write('id,status\\n' + ''.join(f'{i},done\\n' for i in range(1000)))\nassert status_counts('big.csv') == {'done': 1000}\n",
  "explanation": "DictReader maps each row to the header names. Normalising the status before counting merges values that differ only in case or spaces."
}
```
