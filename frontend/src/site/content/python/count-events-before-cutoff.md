---
id: PY-031
title: Count Events Before Cutoff
slug: count-events-before-cutoff
difficulty: Easy
category: dsa
skill: incremental
description: Use binary search to count sorted timestamps before a cutoff.
topic: python-modules-packages
concepts: bisect, binary search, sorted data
time: O(log n)
space: O(1)
minutes: 6
---

## Scenario

A log index holds sorted epoch timestamps. An alert needs to know how many events happened strictly before a cutoff without scanning millions of rows.

## Problem

Write `count_before(timestamps, cutoff)` where timestamps is sorted ascending. Return how many are strictly less than cutoff. Use the bisect module.

## Objective

Use binary search to count sorted timestamps strictly earlier than the cutoff.

## Input format

A sorted list of ints and an int cutoff.

## Output format

An int.

## Constraints

- Duplicates allowed

## Examples

```
count_before([10, 20, 20, 30], 20)  ->  1
count_before([10, 20], 99)  ->  2
```

## Hints

- bisect_left returns the insert position before equal items.
- That position equals the count of smaller items.

## Why it matters

Binary search on sorted keys is how partitions and watermarks are located quickly. It is the same idea a database index uses.

```task
{
  "id": "count-events-before-cutoff",
  "title": "Count Events Before Cutoff",
  "type": "python",
  "instructions": "Write `count_before(timestamps, cutoff)` where timestamps is sorted ascending. Return how many are strictly less than cutoff. Use the bisect module.",
  "starter": "def count_before(timestamps, cutoff):\n    raise NotImplementedError\n",
  "solution": "from bisect import bisect_left\n\ndef count_before(timestamps, cutoff):\n    return bisect_left(timestamps, cutoff)\n",
  "tests": "assert count_before([10, 20, 20, 30], 20) == 1\nassert count_before([10, 20], 99) == 2\n",
  "hidden": "assert count_before([], 5) == 0\nassert count_before([5, 6], 1) == 0\nassert count_before(list(range(1000000)), 500000) == 500000\nassert count_before([7, 7, 7], 7) == 0\n",
  "explanation": "bisect_left finds the leftmost insert position for cutoff in O(log n). Every item before that position is strictly smaller, so the position is the count."
}
```
