---
id: PY-139
title: Pivot Long Records To A Wide Table
slug: pivot-records
difficulty: Hard
category: processing
skill: transformation
description: Turn (row, column, value) records into a table with a fill value.
topic: python-etl-pipelines
concepts: pivoting, aggregation, missing values
time: O(n + R * C + R log R + C log C)
space: O(R * C)
minutes: 25
---

## Scenario

A sales system stores long-format rows of (store, month, revenue), with some stores missing months and some months reported twice. The finance team wants a wide table with one row per store and one column per month.

## Problem

`records` are (row_key, column_key, value). Return {'columns': sorted column keys, 'rows': {row_key: [values in column order]}} where duplicate (row, column) pairs are summed and missing cells use `fill`. Rows are ordered by sorted row_key.

## Objective

Pivot (row_key, column_key, value) records into sorted columns and rows, summing duplicates and filling missing cells.

## Input format

A list of 3-tuples and a fill value.

## Output format

A dict.

## Constraints

- Duplicates are summed

## Examples

```
pivot([('jan', 'tea', 3), ('jan', 'coffee', 2), ('feb', 'tea', 1)])  ->  {'columns': ['coffee', 'tea'], 'rows': {'feb': [0, 1], 'jan': [2, 3]}}
```

## Hints

- Accumulate into a dict keyed by (row, column).
- Build each row by looking up every column with a default.

## Why it matters

Reshaping between long and wide formats is a daily reporting task, and understanding it in plain Python makes pandas pivot_table and SQL PIVOT behaviour predictable.

```task
{
  "id": "pivot-records",
  "title": "Pivot Long Records To A Wide Table",
  "type": "python",
  "instructions": "`records` are (row_key, column_key, value). Return {'columns': sorted column keys, 'rows': {row_key: [values in column order]}} where duplicate (row, column) pairs are summed and missing cells use `fill`. Rows are ordered by sorted row_key.",
  "starter": "def pivot(records: list, fill=0) -> dict:\n    raise NotImplementedError\n",
  "solution": "from collections import defaultdict\n\n\ndef pivot(records: list, fill=0) -> dict:\n    cells = defaultdict(int)\n    rows, cols = set(), set()\n    for r, c, v in records:\n        cells[(r, c)] += v\n        rows.add(r)\n        cols.add(c)\n    columns = sorted(cols)\n    return {'columns': columns, 'rows': {r: [cells[(r, c)] if (r, c) in cells else fill for c in columns] for r in sorted(rows)}}\n",
  "tests": "assert pivot([('jan', 'tea', 3), ('jan', 'coffee', 2), ('feb', 'tea', 1)]) == {'columns': ['coffee', 'tea'], 'rows': {'feb': [0, 1], 'jan': [2, 3]}}\n",
  "hidden": "assert pivot([]) == {'columns': [], 'rows': {}}\nr = pivot([('a', 'x', 1), ('a', 'x', 2), ('b', 'y', 5)], fill=None)\nassert r == {'columns': ['x', 'y'], 'rows': {'a': [3, None], 'b': [None, 5]}}\nassert list(r['rows']) == ['a', 'b']\nr = pivot([('r', 'c', 0)], fill=-1)\nassert r['rows'] == {'r': [0]}\n",
  "explanation": "Collecting cells by (row, column) handles duplicates by summing. Checking whether a cell exists (rather than whether it's truthy) keeps genuine zero values distinct from missing cells, which get `fill`."
}
```
