---
title: Chunk an Iterable with a Generator
slug: chunk-generator
difficulty: Medium
description: Write a lazy generator that yields fixed-size batches for bulk inserts.
topic: python-functions
minutes: 15
---

## Problem

Write `def chunked(iterable, size: int)` as a generator yielding lists of up to `size` items; the last
chunk may be shorter. It must work on any iterable (including infinite generators) without materialising it.
Raise `ValueError` if `size < 1`.

## Examples

```
list(chunked([1, 2, 3, 4, 5], 2))  ->  [[1, 2], [3, 4], [5]]
list(chunked([], 3))  ->  []
```

## Hints

- `itertools.islice(it, size)` takes the next batch from an iterator.
- Stop when a batch comes back empty.

```task
{
  "id": "chunk-generator",
  "title": "Chunk an Iterable with a Generator",
  "type": "python",
  "instructions": "Write `def chunked(iterable, size: int)` as a generator yielding lists of up to `size` items; the last\nchunk may be shorter. It must work on any iterable (including infinite generators) without materialising it.\nRaise `ValueError` if `size < 1`.",
  "starter": "def chunked(iterable, size: int):\n    raise NotImplementedError\n",
  "solution": "from itertools import islice\n\ndef chunked(iterable, size: int):\n    if size < 1:\n        raise ValueError(\"size must be >= 1\")\n    it = iter(iterable)\n    while True:\n        batch = list(islice(it, size))\n        if not batch:\n            return\n        yield batch\n",
  "tests": "import itertools, types\nassert list(chunked([1, 2, 3, 4, 5], 2)) == [[1, 2], [3, 4], [5]]\nassert list(chunked([], 3)) == []\nassert list(chunked(range(4), 4)) == [[0, 1, 2, 3]]\nassert isinstance(chunked([1], 1), types.GeneratorType)\nassert next(chunked(itertools.count(), 3)) == [0, 1, 2]\ntry:\n    list(chunked([1], 0))\n    assert False, \"expected ValueError\"\nexcept ValueError:\n    pass\n"
}
```
