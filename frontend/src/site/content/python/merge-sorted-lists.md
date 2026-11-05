---
id: PY-009
title: Merge Two Sorted Lists
slug: merge-sorted-lists
difficulty: Medium
category: dsa
skill: transformation
description: Merge two sorted lists in a single linear pass, like the merge step of a sort-merge join.
topic: python-loops
concepts: two pointers, stability, linear merge
time: O(n + m)
space: O(n + m)
minutes: 15
---

## Scenario

Two payment processors each deliver a day's transactions already sorted by timestamp. Reconciliation needs one combined chronological list, and re-sorting everything wastes the order the files already have.

## Problem

Write `def merge_sorted(a: list, b: list) -> list` returning one ascending list with every element of
both inputs (duplicates kept). Do it with two pointers in O(len(a) + len(b)); do not call `sorted`.
When values tie, the element from `a` comes first.

## Objective

Merge two ascending lists into one ascending list in linear time with two pointers, taking from a first on ties.

## Input format

Two sorted lists.

## Output format

One sorted list.

## Constraints

- O(len(a) + len(b))
- Stable: equal items from a come first

## Examples

```
merge_sorted([1, 4, 9], [2, 4, 10])  ->  [1, 2, 4, 4, 9, 10]
merge_sorted([], [1])  ->  [1]
```

## Hints

- Advance whichever pointer holds the smaller value; use `<=` to favour `a` on ties.
- Append the leftover tail of whichever list is not exhausted.

## Why it matters

The two-pointer merge is the heart of merge sort, sort-merge joins and external sorting of files too large for memory.

```task
{
  "id": "merge-sorted-lists",
  "title": "Merge Two Sorted Lists",
  "type": "python",
  "instructions": "Write `def merge_sorted(a: list, b: list) -> list` returning one ascending list with every element of\nboth inputs (duplicates kept). Do it with two pointers in O(len(a) + len(b)); do not call `sorted`.\nWhen values tie, the element from `a` comes first.",
  "starter": "def merge_sorted(a: list, b: list) -> list:\n    raise NotImplementedError\n",
  "solution": "def merge_sorted(a: list, b: list) -> list:\n    i = j = 0\n    out = []\n    while i < len(a) and j < len(b):\n        if a[i] <= b[j]:\n            out.append(a[i]); i += 1\n        else:\n            out.append(b[j]); j += 1\n    out.extend(a[i:])\n    out.extend(b[j:])\n    return out\n",
  "tests": "assert merge_sorted([1, 4, 9], [2, 4, 10]) == [1, 2, 4, 4, 9, 10]\nassert merge_sorted([], [1]) == [1]\nassert merge_sorted([], []) == []\nassert merge_sorted([5], []) == [5]\n",
  "hidden": "x, y = (1, \"a\"), (1, \"b\")\nclass K:\n    def __init__(s, v, t): s.v, s.t = v, t\n    def __le__(s, o): return s.v <= o.v\nr = merge_sorted([K(1, \"a\")], [K(1, \"b\")])\nassert [k.t for k in r] == [\"a\", \"b\"]\n",
  "explanation": "Two indices walk both lists, always taking the smaller head. Using `<=` takes from `a` on ties, which keeps the merge stable. Whatever remains in either list is already sorted and is appended at the end."
}
```
