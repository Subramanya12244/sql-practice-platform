---
id: PY-046
title: Non-Blank Record Generator
slug: non-blank-record-generator
difficulty: Easy
category: advanced
skill: streaming
description: Lazily yield parsed records from raw lines, skipping blanks and comments.
topic: python-functions
concepts: generators, yield, lazy iteration
time: O(n)
space: O(1)
minutes: 6
---

## Scenario

A large pipe-delimited inventory feed should be processed one line at a time instead of loading it all into memory.

## Problem

Write generator `iter_records(lines)` that yields a list of stripped fields for each line, splitting on '|'. Skip blank lines and lines starting with '#'. It must be lazy (work on any iterable, including an infinite one).

## Objective

Lazily yield the split, stripped fields of every line that is not blank and not a comment.

## Input format

An iterable of strings.

## Output format

A generator of lists.

## Constraints

- Must use yield

## Examples

```
list(iter_records(['# hdr', 'A1 | 5', '', 'B2|0']))  ->  [['A1', '5'], ['B2', '0']]
```

## Hints

- Loop over lines and yield instead of appending.
- Strip each line before checking blank or '#'.

## Why it matters

Generators let pipelines stream files of any size with constant memory. Skipping noise lines at the source keeps later steps simple.

```task
{
  "id": "non-blank-record-generator",
  "title": "Non-Blank Record Generator",
  "type": "python",
  "instructions": "Write generator `iter_records(lines)` that yields a list of stripped fields for each line, splitting on '|'. Skip blank lines and lines starting with '#'. It must be lazy (work on any iterable, including an infinite one).",
  "starter": "def iter_records(lines):\n    raise NotImplementedError\n",
  "solution": "def iter_records(lines):\n    for line in lines:\n        s = line.strip()\n        if not s or s.startswith('#'):\n            continue\n        yield [p.strip() for p in s.split('|')]\n",
  "tests": "assert list(iter_records(['# hdr', 'A1 | 5', '', 'B2|0'])) == [['A1', '5'], ['B2', '0']]\n",
  "hidden": "import itertools, types\nassert list(iter_records([])) == []\nassert isinstance(iter_records([]), types.GeneratorType)\ninf = (f'S{i}|{i}' for i in itertools.count())\nassert list(itertools.islice(iter_records(inf), 3)) == [['S0', '0'], ['S1', '1'], ['S2', '2']]\nassert list(iter_records(['  # c', '   ', 'x'])) == [['x']]\n",
  "explanation": "yield produces one record at a time, so the function never holds the whole input. Because it pulls lazily, it even works with an infinite iterator through islice."
}
```
