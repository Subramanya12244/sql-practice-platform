---
id: PY-134
title: Lazy Data Pipeline With Generators
slug: lazy-pipeline
difficulty: Hard
category: advanced
skill: streaming
description: Compose read → parse → filter → batch stages that process one record at a time.
topic: python-etl-pipelines
concepts: generator composition, laziness, batching
time: O(n)
space: O(batch_size)
minutes: 25
---

## Scenario

A transaction file arrives as 'id,amount' lines with stray spaces and some malformed rows. The loader should clean, filter and batch the rows lazily so only one batch is in memory at a time.

## Problem

`lines` yields CSV-like strings 'id,amount'. Build a lazy pipeline that trims spaces around each field, skips blank or malformed lines, parses amount as float, keeps rows with amount ≥ min_amount and yields lists of up to batch_size (id, amount) tuples. Nothing may be read before it is needed.

## Objective

Compose generators that parse and clean lines, filter by min_amount and yield batches of (id, amount) tuples lazily.

## Input format

An iterable of strings.

## Output format

A generator of lists.

## Constraints

- Must work on infinite input
- Read lazily

## Examples

```
list(pipeline(['a,5', 'bad', 'b,1', 'c,7'], 2, 2))  ->  [[('a', 5.0), ('c', 7.0)]]
```

## Hints

- Write small generators: parse(lines), keep(rows), batch(rows).
- itertools.islice(rows, n) takes the next n items lazily.

## Why it matters

Generator pipelines let you process files larger than memory with clear, testable stages, the same model streaming frameworks use.

```task
{
  "id": "lazy-pipeline",
  "title": "Lazy Data Pipeline With Generators",
  "type": "python",
  "instructions": "`lines` yields CSV-like strings 'id,amount'. Build a lazy pipeline that trims spaces around each field, skips blank or malformed lines, parses amount as float, keeps rows with amount ≥ min_amount and yields lists of up to batch_size (id, amount) tuples. Nothing may be read before it is needed.",
  "starter": "def pipeline(lines, min_amount: float, batch_size: int):\n    raise NotImplementedError\n",
  "solution": "import itertools\n\n\ndef parse(lines):\n    for line in lines:\n        parts = [x.strip() for x in line.split(',')]\n        if len(parts) != 2 or not parts[0]:\n            continue\n        try:\n            yield parts[0], float(parts[1])\n        except ValueError:\n            continue\n\n\ndef pipeline(lines, min_amount: float, batch_size: int):\n    rows = (r for r in parse(lines) if r[1] >= min_amount)\n    while True:\n        batch = list(itertools.islice(rows, batch_size))\n        if not batch:\n            return\n        yield batch\n",
  "tests": "assert list(pipeline(['a,5', 'bad', 'b,1', 'c,7'], 2, 2)) == [[('a', 5.0), ('c', 7.0)]]\n",
  "hidden": "import itertools\nconsumed = []\ndef source():\n    for i in itertools.count():\n        consumed.append(i)\n        yield f'r{i},{i}'\ng = pipeline(source(), 0, 3)\nassert next(g) == [('r0', 0.0), ('r1', 1.0), ('r2', 2.0)]\nassert len(consumed) == 3\nassert list(pipeline([], 0, 5)) == []\nassert list(pipeline(['x,1', ',2', 'y,abc', ' z , 3 ', 'w,4'], 0, 10)) == [[('x', 1.0), ('z', 3.0), ('w', 4.0)]]\n",
  "explanation": "Each stage pulls one record from the previous stage only when asked, so memory stays constant and infinite sources work. The test counts how many lines were read to prove nothing is consumed ahead of time."
}
```
