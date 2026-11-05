---
id: PY-102
title: Sliding Window Maximum
slug: sliding-window-max
difficulty: Medium
category: dsa
skill: streaming
description: Maximum of every window of size k in O(n).
topic: python-collections
concepts: deque, monotonic queue
time: O(n)
space: O(k)
minutes: 20
---

## Scenario

An inventory system logs hourly stock levels, and planners want the peak level over every rolling k-hour window to size storage. Scanning each window separately is too slow for long histories.

## Problem

Return the maximum of each contiguous window of size k. Return [] if k > len(nums); raise ValueError if k < 1.

## Objective

Return the maximum of every contiguous window of size k, [] when k exceeds the length, and ValueError when k < 1.

## Input format

A list of numbers and k.

## Output format

A list of len(nums) − k + 1 values.

## Constraints

- O(n) expected; len up to 10^5

## Examples

```
window_max([1, 3, -1, -3, 5, 3, 6, 7], 3)  ->  [3, 3, 5, 5, 6, 7]
```

## Hints

- Keep indices in a deque with decreasing values.
- Drop indices that have left the window from the front.

## Why it matters

Rolling metrics are common in time-series monitoring, and the monotonic deque shows how to compute them in linear time instead of O(n*k).

```task
{
  "id": "sliding-window-max",
  "title": "Sliding Window Maximum",
  "type": "python",
  "instructions": "Return the maximum of each contiguous window of size k. Return [] if k > len(nums); raise ValueError if k < 1.",
  "starter": "def window_max(nums: list, k: int) -> list:\n    raise NotImplementedError\n",
  "solution": "from collections import deque\n\n\ndef window_max(nums: list, k: int) -> list:\n    if k < 1:\n        raise ValueError('k must be >= 1')\n    dq, out = deque(), []\n    for i, x in enumerate(nums):\n        while dq and nums[dq[-1]] <= x:\n            dq.pop()\n        dq.append(i)\n        if dq[0] <= i - k:\n            dq.popleft()\n        if i >= k - 1:\n            out.append(nums[dq[0]])\n    return out\n",
  "tests": "assert window_max([1, 3, -1, -3, 5, 3, 6, 7], 3) == [3, 3, 5, 5, 6, 7]\n",
  "hidden": "assert window_max([4, 2], 5) == []\nassert window_max([5], 1) == [5]\nassert window_max([9, 8, 7, 6], 2) == [9, 8, 7]\nimport random\nrandom.seed(1)\nxs = [random.randint(-100, 100) for _ in range(2000)]\nassert window_max(xs, 17) == [max(xs[i:i + 17]) for i in range(len(xs) - 16)]\ntry:\n    window_max([1], 0)\n    raise AssertionError('expected ValueError')\nexcept ValueError:\n    pass\n",
  "explanation": "The deque holds indices whose values decrease from front to back, so the front is always the window maximum. Each index is added and removed at most once, giving O(n)."
}
```
