---
id: PY-062
title: Top K Largest
slug: top-k-largest
difficulty: Easy
category: dsa
skill: aggregation
description: Return the k largest values, largest first.
topic: python-collections
concepts: sorted, reverse, slicing
time: O(n log n)
space: O(n)
minutes: 5
---

## Scenario

A sales dashboard shows the k largest order amounts of the day, including repeated amounts. The widget may ask for more items than there are orders.

## Problem

Return the k largest values in `nums` in descending order (duplicates allowed). If k exceeds the length, return all values sorted descending. k ≤ 0 returns [].

## Objective

Return the k largest values in descending order, all values when k exceeds the length, and [] when k <= 0.

## Input format

`nums`: a list of numbers; `k`: an int.

## Output format

A list.

## Constraints

- Don't modify nums

## Examples

```
top_k([5, 1, 9, 3, 9], 2)  ->  [9, 9]
```

## Hints

- `sorted(nums, reverse=True)[:k]` — guard k ≤ 0 first.
- Slicing past the end is safe and returns everything.

## Why it matters

Top-N queries are everywhere in reporting, and handling the edge cases of k makes the function safe to call from any dashboard parameter.

```task
{
  "id": "top-k-largest",
  "title": "Top K Largest",
  "type": "python",
  "instructions": "Return the k largest values in `nums` in descending order (duplicates allowed). If k exceeds the length, return all values sorted descending. k ≤ 0 returns [].",
  "starter": "def top_k(nums: list, k: int) -> list:\n    raise NotImplementedError\n",
  "solution": "def top_k(nums: list, k: int) -> list:\n    if k <= 0:\n        return []\n    return sorted(nums, reverse=True)[:k]\n",
  "tests": "assert top_k([5, 1, 9, 3, 9], 2) == [9, 9]\nassert top_k([1, 2], 5) == [2, 1]\n",
  "hidden": "x = [3, 1, 2]\nassert top_k(x, 1) == [3] and x == [3, 1, 2]\nassert top_k([], 3) == []\nassert top_k([1, 2, 3], 0) == []\nassert top_k([1, 2, 3], -1) == []\n",
  "explanation": "`sorted` returns a new list, so the input is untouched. The k ≤ 0 guard matters because `[:-1]` would return all but the last item instead of nothing."
}
```
