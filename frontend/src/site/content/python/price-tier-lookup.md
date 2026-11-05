---
id: PY-066
title: Assign Price Tiers With Binary Search
slug: price-tier-lookup
difficulty: Medium
category: dsa
skill: transformation
description: Map each product price to a tier label using bisect on sorted boundaries.
topic: python-collections
concepts: bisect, sorted boundaries
time: O((n + t) log t)
space: O(t)
minutes: 10
---

## Scenario

The pricing team defines tiers by lower bounds, for example 0 budget, 20 standard, 100 premium. A catalogue of thousands of products must be labelled quickly.

## Problem

Write assign_tiers(prices, tiers). tiers is a list of (lower_bound, label) in any order. A price belongs to the tier with the largest lower_bound <= price. Prices below every bound or None get 'unknown'. Return the labels in the same order as prices.

## Objective

Use binary search instead of linear scans for range lookups.

## Input format

prices: list of numbers or None; tiers: list of tuples.

## Output format

list of str.

## Constraints

- Boundaries are inclusive lower bounds

## Examples

```
assign_tiers([5, 20, 150, None], [(100,'premium'),(0,'budget'),(20,'standard')])  ->  ['budget','standard','premium','unknown']
```

## Hints

- Sort the tiers by bound and keep a separate list of bounds.
- bisect_right(bounds, price) - 1 is the index you want.

## Why it matters

Range bucketing (tiers, age bands, SLA buckets) appears in almost every reporting model. bisect turns it into O(log t) per row.

```task
{
  "id": "price-tier-lookup",
  "title": "Assign Price Tiers With Binary Search",
  "type": "python",
  "instructions": "Write assign_tiers(prices, tiers). tiers is a list of (lower_bound, label) in any order. A price belongs to the tier with the largest lower_bound <= price. Prices below every bound or None get 'unknown'. Return the labels in the same order as prices.",
  "starter": "def assign_tiers(prices: list, tiers: list) -> list:\n    raise NotImplementedError\n",
  "solution": "from bisect import bisect_right\n\ndef assign_tiers(prices: list, tiers: list) -> list:\n    tiers = sorted(tiers)\n    bounds = [b for b, _ in tiers]\n    out = []\n    for p in prices:\n        i = -1 if p is None else bisect_right(bounds, p) - 1\n        out.append(tiers[i][1] if i >= 0 else 'unknown')\n    return out\n",
  "tests": "assert assign_tiers([5, 20, 150, None], [(100,'premium'),(0,'budget'),(20,'standard')]) == ['budget','standard','premium','unknown']\nassert assign_tiers([19.99], [(0,'a'),(20,'b')]) == ['a']\n",
  "hidden": "assert assign_tiers([], [(0,'a')]) == []\nassert assign_tiers([1], []) == ['unknown']\nassert assign_tiers([-5, 0], [(0,'a')]) == ['unknown','a']\nassert assign_tiers([10**9], [(0,'a'),(5,'b')]) == ['b']\nr=assign_tiers(list(range(10000)), [(i*100,str(i)) for i in range(100)])\nassert r[0]=='0' and r[9999]=='99' and r[150]=='1'\n",
  "explanation": "Sorting tiers once lets bisect_right find, in O(log t), how many bounds are <= price. Subtracting one gives the tier with the largest qualifying bound. An index of -1 means the price is below every bound, and None is short-circuited to the same case."
}
```
