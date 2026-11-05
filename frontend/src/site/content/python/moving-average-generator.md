---
id: PY-092
title: Moving Average Generator
slug: moving-average-generator
difficulty: Medium
category: advanced
skill: streaming
description: Lazily yield moving averages over a stream.
topic: python-functions
concepts: generators, deque, running sum
time: O(n)
space: O(n_window)
minutes: 10
---

## Scenario

A sensor stream sends one reading per second without end. The dashboard shows a smoothed value: the average of the last n readings.

## Problem

Write a generator that consumes any iterable and yields the average of the last `n` values once n values have been seen, rounded to 2 dp. It must work on infinite iterators.

## Objective

Write a generator that yields the rounded average of the last n values once n have been seen, working on infinite iterators.

## Input format

An iterable of numbers, n ≥ 1.

## Output format

A generator of floats.

## Constraints

- O(1) per value; don't store the whole stream

## Examples

```
list(moving_average([1, 2, 3, 4], 2))  ->  [1.5, 2.5, 3.5]
```

## Hints

- Keep a deque(maxlen=n) and a running total.
- Subtract the value that falls out of the window.

## Why it matters

Rolling aggregates over unbounded streams need constant memory per window, and a deque with a running sum is the standard way to get it.

```task
{
  "id": "moving-average-generator",
  "title": "Moving Average Generator",
  "type": "python",
  "instructions": "Write a generator that consumes any iterable and yields the average of the last `n` values once n values have been seen, rounded to 2 dp. It must work on infinite iterators.",
  "starter": "def moving_average(values, n: int):\n    raise NotImplementedError\n",
  "solution": "from collections import deque\n\n\ndef moving_average(values, n: int):\n    window, total = deque(), 0\n    for v in values:\n        window.append(v)\n        total += v\n        if len(window) > n:\n            total -= window.popleft()\n        if len(window) == n:\n            yield round(total / n, 2)\n",
  "tests": "assert list(moving_average([1, 2, 3, 4], 2)) == [1.5, 2.5, 3.5]\n",
  "hidden": "import itertools\nassert list(moving_average([5], 2)) == []\nassert list(moving_average([1, 2, 3], 1)) == [1.0, 2.0, 3.0]\ng = moving_average(itertools.count(1), 3)\nassert list(itertools.islice(g, 3)) == [2.0, 3.0, 4.0]\nassert list(moving_average(iter([1, 1, 4]), 3)) == [2.0]\n",
  "explanation": "A generator processes one value at a time, so it can read an infinite stream. Updating a running total instead of re-summing the window keeps each step O(1)."
}
```
