---
id: PY-022
title: Batch Records for Load
slug: batch-records-for-load
difficulty: Easy
category: etl
skill: performance
description: Split records into fixed-size batches for a bulk insert.
topic: python-etl-pipelines
concepts: slicing, range step
time: O(n)
space: O(n)
minutes: 5
---

## Scenario

The warehouse API accepts at most N rows per insert call, so the loader must split each extract into batches.

## Problem

Write `make_batches(records, size)` returning a list of lists, each with at most size records, in order. size < 1 raises ValueError.

## Objective

Split the records into ordered batches of at most the given size, rejecting sizes below 1.

## Input format

A list and an int.

## Output format

A list of lists.

## Constraints

- Last batch may be smaller

## Examples

```
make_batches([1, 2, 3, 4, 5], 2)  ->  [[1, 2], [3, 4], [5]]
```

## Hints

- range(0, len(records), size) gives batch starts.
- Validate size first.

## Why it matters

Batching is how loaders respect API and database limits while staying efficient. Getting the last partial batch right avoids dropped rows.

```task
{
  "id": "batch-records-for-load",
  "title": "Batch Records for Load",
  "type": "python",
  "instructions": "Write `make_batches(records, size)` returning a list of lists, each with at most size records, in order. size < 1 raises ValueError.",
  "starter": "def make_batches(records, size):\n    raise NotImplementedError\n",
  "solution": "def make_batches(records, size):\n    if size < 1:\n        raise ValueError('size must be >= 1')\n    return [records[i:i + size] for i in range(0, len(records), size)]\n",
  "tests": "assert make_batches([1, 2, 3, 4, 5], 2) == [[1, 2], [3, 4], [5]]\nassert make_batches(['a'], 10) == [['a']]\n",
  "hidden": "assert make_batches([], 3) == []\ntry:\n    make_batches([1], 0)\n    raise AssertionError('expected ValueError')\nexcept ValueError:\n    pass\nassert len(make_batches(list(range(10001)), 1000)) == 11\nassert make_batches([1, 2], 1) == [[1], [2]]\n",
  "explanation": "Stepping range by size gives each batch's start index, and slicing past the end safely returns the shorter last batch. Validating size prevents an infinite or invalid range."
}
```
