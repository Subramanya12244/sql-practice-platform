---
id: PY-144
title: Running Median
slug: median-of-stream
difficulty: Hard
category: dsa
skill: streaming
description: Median of a growing stream in O(log n) per insert.
topic: python-oop
concepts: two heaps, balancing
time: O(log n) per add, O(1) per median
space: O(n)
minutes: 25
---

## Scenario

An API gateway emits response latencies continuously, and the monitoring page shows the median latency so far after every request. Re-sorting all latencies each time is too slow.

## Problem

`RunningMedian` has `add(x)` and `median()` (mean of the two middle values for an even count; ValueError when empty). add must be O(log n).

## Objective

Build a RunningMedian with O(log n) add and a median method that raises ValueError when empty.

## Input format

Numbers.

## Output format

A number.

## Constraints

- O(log n) add, O(1) median

## Examples

```
m = RunningMedian(); m.add(5); m.add(1); m.median()  ->  3.0
```

## Hints

- A max-heap (negated values) for the lower half, a min-heap for the upper half.
- Keep their sizes within one of each other.

## Why it matters

Streaming statistics must be updated incrementally, and the two-heap technique shows how to keep an exact percentile without reprocessing history.

```task
{
  "id": "median-of-stream",
  "title": "Running Median",
  "type": "python",
  "instructions": "`RunningMedian` has `add(x)` and `median()` (mean of the two middle values for an even count; ValueError when empty). add must be O(log n).",
  "starter": "class RunningMedian:\n    def __init__(self):\n        raise NotImplementedError\n",
  "solution": "import heapq\n\n\nclass RunningMedian:\n    def __init__(self):\n        self.low, self.high = [], []\n\n    def add(self, x) -> None:\n        heapq.heappush(self.low, -x)\n        heapq.heappush(self.high, -heapq.heappop(self.low))\n        if len(self.high) > len(self.low):\n            heapq.heappush(self.low, -heapq.heappop(self.high))\n\n    def median(self):\n        if not self.low:\n            raise ValueError('no values')\n        if len(self.low) > len(self.high):\n            return -self.low[0]\n        return (-self.low[0] + self.high[0]) / 2\n",
  "tests": "m = RunningMedian()\nm.add(5); m.add(1)\nassert m.median() == 3.0\nm.add(10)\nassert m.median() == 5\n",
  "hidden": "m = RunningMedian()\ntry:\n    m.median()\n    raise AssertionError('expected ValueError')\nexcept ValueError:\n    pass\nimport random, statistics\nrandom.seed(7)\nxs = []\nfor _ in range(3000):\n    v = random.randint(-1000, 1000)\n    xs.append(v); m.add(v)\nassert m.median() == statistics.median(xs)\nm2 = RunningMedian()\nfor v in (2, 2, 2):\n    m2.add(v)\nassert m2.median() == 2\n",
  "explanation": "The lower half lives in a max-heap and the upper half in a min-heap, so the middle values are always at the two tops. Routing each new value through the low heap into the high heap keeps every low value ≤ every high value."
}
```
