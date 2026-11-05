---
id: PY-064
title: Write Daily Summary JSON
slug: write-daily-summary-json
difficulty: Easy
category: files
skill: ingestion
description: Write a sales summary to a JSON file and read it back.
topic: python-csv-json
concepts: json.dump, with open, sort_keys
time: O(n)
space: O(k)
minutes: 6
---

## Scenario

A nightly job writes a small JSON summary of sales per store that a dashboard reads the next morning.

## Problem

Write `write_summary(sales, path)` where sales is a list of (store, amount) tuples. Write a JSON object of store -> total amount (rounded to 2) to path, with sorted keys, and return the dict that was written.

## Objective

Total sales per store, write the totals to a sorted-key JSON file, and return them.

## Input format

A list of tuples and a file path.

## Output format

A dict, also saved to the file.

## Constraints

- Use json.dump in a with block

## Examples

```
write_summary([('S1', 10), ('S2', 5), ('S1', 2.5)], 'out.json')  ->  {'S1': 12.5, 'S2': 5}
```

## Hints

- Aggregate into a dict first.
- Open the file with 'w' and call json.dump(data, f, sort_keys=True).

## Why it matters

Writing small JSON artifacts like summaries and manifests is common in pipelines. Sorted keys make the files stable and diffable.

```task
{
  "id": "write-daily-summary-json",
  "title": "Write Daily Summary JSON",
  "type": "python",
  "instructions": "Write `write_summary(sales, path)` where sales is a list of (store, amount) tuples. Write a JSON object of store -> total amount (rounded to 2) to path, with sorted keys, and return the dict that was written.",
  "starter": "def write_summary(sales, path):\n    raise NotImplementedError\n",
  "solution": "import json\n\ndef write_summary(sales, path):\n    totals = {}\n    for store, amt in sales:\n        totals[store] = totals.get(store, 0) + amt\n    totals = {k: round(v, 2) for k, v in totals.items()}\n    with open(path, 'w') as f:\n        json.dump(totals, f, sort_keys=True)\n    return totals\n",
  "tests": "import json\nassert write_summary([('S1', 10), ('S2', 5), ('S1', 2.5)], 'out.json') == {'S1': 12.5, 'S2': 5}\nassert json.load(open('out.json')) == {'S1': 12.5, 'S2': 5}\n",
  "hidden": "import json\nassert write_summary([], 'e.json') == {}\nassert open('e.json').read() == '{}'\nwrite_summary([('b', 1), ('a', 2)], 's.json')\nassert open('s.json').read() == '{\"a\": 2, \"b\": 1}'\nassert write_summary([('x', 0.1)] * 3, 'r.json') == {'x': 0.3}\n",
  "explanation": "Totals are built in memory, rounded, then written with json.dump. sort_keys makes the file byte-stable across runs."
}
```
