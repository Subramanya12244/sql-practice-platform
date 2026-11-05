---
id: PY-090
title: Merge K Sorted Iterables
slug: merge-k-sorted
difficulty: Medium
category: dsa
skill: streaming
description: Lazily merge any number of sorted iterables.
topic: python-collections
concepts: heapq, generators, laziness
time: O(N log k)
space: O(k)
minutes: 15
---

## Scenario

Each of several application servers writes its own log file sorted by timestamp. The incident tool needs one combined, time-ordered stream without loading every file into memory.

## Problem

Yield all values from several sorted iterables in sorted order, lazily, using a heap. Values with equal keys keep the order of the iterables they came from.

## Objective

Lazily yield all values from several sorted iterables in sorted order using a heap, keeping iterable order on ties.

## Input format

Any number of sorted iterables.

## Output format

A generator.

## Constraints

- Don't use heapq.merge
- Works on infinite sorted iterators

## Examples

```
list(merge_sorted([1, 4], [2, 3], []))  ->  [1, 2, 3, 4]
```

## Hints

- Push (value, source_index, iterator) for each first item.
- Pop the smallest, yield it, push that source's next value.

## Why it matters

K-way merging is how external sorts and log aggregators combine sorted partitions, and doing it lazily keeps memory at O(k) regardless of data size.

```task
{
  "id": "merge-k-sorted",
  "title": "Merge K Sorted Iterables",
  "type": "python",
  "instructions": "Yield all values from several sorted iterables in sorted order, lazily, using a heap. Values with equal keys keep the order of the iterables they came from.",
  "starter": "def merge_sorted(*iterables):\n    raise NotImplementedError\n",
  "solution": "import heapq\n\n\ndef merge_sorted(*iterables):\n    heap = []\n    for i, it in enumerate(map(iter, iterables)):\n        for v in it:\n            heap.append((v, i, it))\n            break\n    heapq.heapify(heap)\n    while heap:\n        v, i, it = heap[0]\n        yield v\n        for nxt in it:\n            heapq.heapreplace(heap, (nxt, i, it))\n            break\n        else:\n            heapq.heappop(heap)\n",
  "tests": "assert list(merge_sorted([1, 4], [2, 3], [])) == [1, 2, 3, 4]\n",
  "hidden": "import itertools\nassert list(merge_sorted()) == []\nassert list(merge_sorted([1, 1], [1])) == [1, 1, 1]\nevens, odds = itertools.count(0, 2), itertools.count(1, 2)\nassert list(itertools.islice(merge_sorted(evens, odds), 6)) == [0, 1, 2, 3, 4, 5]\nassert list(merge_sorted('ace', 'bd')) == ['a', 'b', 'c', 'd', 'e']\n",
  "explanation": "The heap holds one current value per source, so memory is O(k) regardless of input size. The source index breaks ties so iterators themselves are never compared, and keeps equal values in source order."
}
```
