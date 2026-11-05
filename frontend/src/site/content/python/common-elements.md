---
id: PY-026
title: Common Elements, Sorted
slug: common-elements
difficulty: Easy
category: dsa
skill: transformation
description: Find values present in both lists, sorted and without duplicates.
topic: python-collections
concepts: set intersection, sorted
time: O(n log n)
space: O(n)
minutes: 5
---

## Scenario

Marketing has one list of customer IDs who opened an email and another of customer IDs who placed an order this week. They want the customers who did both.

## Problem

Return the values that appear in both `a` and `b`, each once, in ascending order.

## Objective

Return the distinct values present in both lists, in ascending order.

## Input format

Two lists of comparable values.

## Output format

A sorted list.

## Constraints

- Lists may contain duplicates

## Examples

```
common([1, 2, 2, 3], [2, 3, 3, 4])  ->  [2, 3]
```

## Hints

- `set(a) & set(b)` gives the intersection.
- `sorted()` accepts a set and returns a list.

## Why it matters

Set intersection is the in-memory equivalent of an inner join on keys, and knowing it is O(n) helps you choose the right tool when comparing large ID lists.

```task
{
  "id": "common-elements",
  "title": "Common Elements, Sorted",
  "type": "python",
  "instructions": "Return the values that appear in both `a` and `b`, each once, in ascending order.",
  "starter": "def common(a: list, b: list) -> list:\n    raise NotImplementedError\n",
  "solution": "def common(a: list, b: list) -> list:\n    return sorted(set(a) & set(b))\n",
  "tests": "assert common([1, 2, 2, 3], [2, 3, 3, 4]) == [2, 3]\nassert common([], [1]) == []\n",
  "hidden": "assert common([5, 1], [1, 5]) == [1, 5]\nassert common(['b', 'a'], ['a', 'c']) == ['a']\nassert common([1, 2], [3, 4]) == []\n",
  "explanation": "Sets remove duplicates and `&` intersects them in O(len(a) + len(b)); `sorted` turns the set into an ordered list."
}
```
