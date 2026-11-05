---
id: PY-067
title: Buffered Batch Writer With Flush Every N
slug: buffered-batch-writer
difficulty: Medium
category: etl
skill: performance
description: A writer class that buffers records and flushes them to a sink in batches.
topic: python-etl-pipelines
concepts: buffering, context manager protocol, sink callable
time: O(n)
space: O(size)
minutes: 15
---

## Scenario

Inserting warehouse rows one at a time is slow. The loader should collect rows and send them in batches of N, flushing the remainder at the end.

## Problem

Write class BatchWriter(sink, size). write(record) buffers a record and calls sink(list_of_records) when the buffer reaches size. flush() sends any buffered records (never calls sink with an empty list). Support use as a context manager: on exit, flush only if no exception occurred. Track self.batches (number of sink calls) and self.written (records sent).

## Objective

Implement a buffered sink with clean shutdown semantics.

## Input format

sink callable, int size >= 1.

## Output format

Side effects on sink; counters.

## Constraints

- size < 1 raises ValueError

## Examples

```
with BatchWriter(sink, 2) as w: for r in range(5): w.write(r)  ->  sink called with [0,1], [2,3], [4]
```

## Hints

- Pass a copy of the buffer to sink, then reset it.
- __exit__ receives exc_type; return False so exceptions propagate.

## Why it matters

Batching is the simplest big win for load performance against databases and APIs. Getting flush-on-exit right avoids losing the last partial batch.

```task
{
  "id": "buffered-batch-writer",
  "title": "Buffered Batch Writer With Flush Every N",
  "type": "python",
  "instructions": "Write class BatchWriter(sink, size). write(record) buffers a record and calls sink(list_of_records) when the buffer reaches size. flush() sends any buffered records (never calls sink with an empty list). Support use as a context manager: on exit, flush only if no exception occurred. Track self.batches (number of sink calls) and self.written (records sent).",
  "starter": "class BatchWriter:\n    def __init__(self, sink, size: int):\n        raise NotImplementedError\n",
  "solution": "class BatchWriter:\n    def __init__(self, sink, size: int):\n        if size < 1:\n            raise ValueError('size must be >= 1')\n        self.sink, self.size = sink, size\n        self.buf = []\n        self.batches = self.written = 0\n\n    def write(self, record):\n        self.buf.append(record)\n        if len(self.buf) >= self.size:\n            self.flush()\n\n    def flush(self):\n        if self.buf:\n            batch, self.buf = self.buf, []\n            self.sink(batch)\n            self.batches += 1\n            self.written += len(batch)\n\n    def __enter__(self):\n        return self\n\n    def __exit__(self, exc_type, exc, tb):\n        if exc_type is None:\n            self.flush()\n        return False\n",
  "tests": "got=[]\nwith BatchWriter(got.append, 2) as w:\n    for r in range(5):\n        w.write(r)\nassert got == [[0,1],[2,3],[4]]\nassert (w.batches, w.written) == (3, 5)\n",
  "hidden": "got=[]\nw=BatchWriter(got.append, 3)\nw.flush()\nassert got == [] and w.batches == 0\ntry:\n    BatchWriter(got.append, 0); assert False\nexcept ValueError:\n    pass\ngot=[]\ntry:\n    with BatchWriter(got.append, 10) as w:\n        w.write(1)\n        raise KeyError('boom')\nexcept KeyError:\n    pass\nassert got == []\ngot=[]\nwith BatchWriter(got.append, 1000) as w:\n    for i in range(10500):\n        w.write(i)\nassert len(got) == 11 and len(got[-1]) == 500 and w.written == 10500\n",
  "explanation": "Records accumulate in a list and are handed to the sink as soon as the list reaches size, bounding memory. flush swaps in a new list before calling the sink so the batch object is not mutated later. The context manager flushes the partial tail only on clean exit, so a failed run does not load half-processed data, and returning False re-raises the error."
}
```
