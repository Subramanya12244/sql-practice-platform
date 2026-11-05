---
id: PY-032
title: Count Non-Empty Lines In A File
slug: count-nonempty-lines
difficulty: Easy
category: files
skill: ingestion
description: Count lines that contain something other than whitespace.
topic: python-file-handling
concepts: file objects, iteration, strip
time: O(n)
space: O(1)
minutes: 5
---

## Scenario

A partner drops a text file of records each night, and the load check compares its record count with the control total. Blank and whitespace-only lines must not be counted.

## Problem

`f` is an open text file (or any file-like object). Return how many of its lines contain at least one non-whitespace character.

## Objective

Count the lines of an open file that contain at least one non-whitespace character.

## Input format

`f`: a readable text file object.

## Output format

An int.

## Constraints

- Read the file once, line by line

## Examples

```
count_nonempty(io.StringIO('a\n\n  \nb\n'))  ->  2
```

## Hints

- Iterating a file yields one line at a time.
- `line.strip()` is empty for whitespace-only lines.

## Why it matters

Row-count checks are a basic data-quality control, and iterating the file object keeps memory flat even for very large files.

```task
{
  "id": "count-nonempty-lines",
  "title": "Count Non-Empty Lines In A File",
  "type": "python",
  "instructions": "`f` is an open text file (or any file-like object). Return how many of its lines contain at least one non-whitespace character.",
  "starter": "def count_nonempty(f) -> int:\n    raise NotImplementedError\n",
  "solution": "def count_nonempty(f) -> int:\n    return sum(1 for line in f if line.strip())\n",
  "tests": "import io\nassert count_nonempty(io.StringIO('a\\n\\n  \\nb\\n')) == 2\nassert count_nonempty(io.StringIO('')) == 0\n",
  "hidden": "import io, os, tempfile\nassert count_nonempty(io.StringIO('x')) == 1\nassert count_nonempty(io.StringIO('\\t\\n\\r\\n')) == 0\nd = tempfile.mkdtemp()\np = os.path.join(d, 'f.txt')\nwith open(p, 'w') as fh:\n    fh.write('one\\n\\ntwo\\nthree\\n')\nwith open(p) as fh:\n    assert count_nonempty(fh) == 3\n",
  "explanation": "Iterating a file object streams lines without loading the whole file, so this works on large files. `io.StringIO` behaves like a file, which makes the function easy to test."
}
```
