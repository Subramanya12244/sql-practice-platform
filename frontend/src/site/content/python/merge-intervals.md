---
id: PY-091
title: Merge Overlapping Intervals
slug: merge-intervals
difficulty: Medium
category: dsa
skill: aggregation
description: Combine overlapping or touching intervals.
topic: python-collections
concepts: sorting, merging, tuples
time: O(n log n)
space: O(n)
minutes: 15
---

## Scenario

A monitoring system records outage windows from several probes as (start, end) pairs that often overlap. The SLA report needs the distinct periods when the service was down.

## Problem

Given (start, end) pairs, merge all overlapping or touching intervals (end ≥ next start) and return them sorted by start as tuples.

## Objective

Merge all overlapping or touching intervals and return them sorted by start as tuples.

## Input format

A list of (start, end) with start ≤ end.

## Output format

A list of tuples.

## Constraints

- Input may be unsorted

## Examples

```
merge_intervals([(1, 3), (8, 10), (2, 6)])  ->  [(1, 6), (8, 10)]
```

## Hints

- Sort by start first.
- Extend the last merged interval while the next one starts before it ends.

## Why it matters

Interval merging appears in downtime reporting, session building and booking systems, and sorting first is what makes it a single linear sweep.

```task
{
  "id": "merge-intervals",
  "title": "Merge Overlapping Intervals",
  "type": "python",
  "instructions": "Given (start, end) pairs, merge all overlapping or touching intervals (end ≥ next start) and return them sorted by start as tuples.",
  "starter": "def merge_intervals(intervals: list) -> list:\n    raise NotImplementedError\n",
  "solution": "def merge_intervals(intervals: list) -> list:\n    out = []\n    for s, e in sorted(intervals):\n        if out and s <= out[-1][1]:\n            out[-1] = (out[-1][0], max(out[-1][1], e))\n        else:\n            out.append((s, e))\n    return out\n",
  "tests": "assert merge_intervals([(1, 3), (8, 10), (2, 6)]) == [(1, 6), (8, 10)]\n",
  "hidden": "assert merge_intervals([]) == []\nassert merge_intervals([(1, 4), (4, 5)]) == [(1, 5)]\nassert merge_intervals([(1, 10), (2, 3)]) == [(1, 10)]\nassert merge_intervals([(5, 6), (1, 2)]) == [(1, 2), (5, 6)]\n",
  "explanation": "After sorting, an interval can only overlap the most recent merged one. `max` handles intervals fully contained in the current one."
}
```
