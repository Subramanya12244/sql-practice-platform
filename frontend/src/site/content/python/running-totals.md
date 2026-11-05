---
id: PY-054
title: Running Totals
slug: running-totals
difficulty: Easy
category: fundamentals
skill: aggregation
description: Return the cumulative sums of a list.
topic: python-loops
concepts: accumulation, loops, lists
time: O(n)
space: O(n)
minutes: 5
---

## Scenario

Finance wants a cumulative revenue line for the month, built from the list of daily order totals.

## Problem

Return a list where element i is the sum of nums[0..i].

## Objective

Return a list where each element is the sum of all input values up to and including that position.

## Input format

`nums`: a list of numbers.

## Output format

A list of the same length.

## Constraints

- 0 ≤ len(nums) ≤ 100 000

## Examples

```
running_totals([3, 1, 4])  ->  [3, 4, 8]
```

## Hints

- Keep a total variable and append it each step.
- `itertools.accumulate` does the same thing.

## Why it matters

Cumulative sums power burn-up charts, balances and SQL window functions like SUM() OVER, and computing them in one pass is the pattern behind efficient window logic.

```task
{
  "id": "running-totals",
  "title": "Running Totals",
  "type": "python",
  "instructions": "Return a list where element i is the sum of nums[0..i].",
  "starter": "def running_totals(nums: list) -> list:\n    raise NotImplementedError\n",
  "solution": "def running_totals(nums: list) -> list:\n    out, total = [], 0\n    for x in nums:\n        total += x\n        out.append(total)\n    return out\n",
  "tests": "assert running_totals([3, 1, 4]) == [3, 4, 8]\nassert running_totals([]) == []\n",
  "hidden": "assert running_totals([5]) == [5]\nassert running_totals([1, -1, 1, -1]) == [1, 0, 1, 0]\nassert running_totals([0.5, 0.25]) == [0.5, 0.75]\nassert running_totals(list(range(1, 101)))[-1] == 5050\n",
  "explanation": "One pass with an accumulator is O(n). Recomputing `sum(nums[:i+1])` for every i would be O(n²)."
}
```
