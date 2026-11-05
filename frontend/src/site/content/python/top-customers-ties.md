---
id: PY-108
title: Top Customers With Ties
slug: top-customers-ties
difficulty: Medium
category: processing
skill: aggregation
description: Return the top N customers by revenue, including ties at the cut-off.
topic: python-etl-pipelines
concepts: grouping, ranking, ties
time: O(n + c log c)
space: O(c)
minutes: 15
---

## Scenario

The sales team rewards its top n customers by revenue, built from a list of (customer, amount) orders. Customers tied with the nth-place total must not be left out.

## Problem

`orders` holds (customer, amount). Sum revenue per customer and return (customer, total) for the top n, plus any customers tied with the nth total, sorted by total desc then name.

## Objective

Sum revenue per customer and return the top n plus anyone tied with the nth total, sorted by total desc then name.

## Input format

A list of tuples and n ≥ 1.

## Output format

A list of tuples.

## Constraints

- Ties at the boundary are all included

## Examples

```
top_customers([('a', 5), ('b', 3), ('c', 3), ('a', 1)], 2)  ->  [('a', 6), ('b', 3), ('c', 3)]
```

## Hints

- Total per customer first.
- Find the nth total, then keep everyone ≥ it.

## Why it matters

Handling ties correctly is the difference between RANK and ROW_NUMBER in SQL, and getting it wrong leads to unfair or unstable reports.

```task
{
  "id": "top-customers-ties",
  "title": "Top Customers With Ties",
  "type": "python",
  "instructions": "`orders` holds (customer, amount). Sum revenue per customer and return (customer, total) for the top n, plus any customers tied with the nth total, sorted by total desc then name.",
  "starter": "def top_customers(orders: list, n: int) -> list:\n    raise NotImplementedError\n",
  "solution": "from collections import defaultdict\n\n\ndef top_customers(orders: list, n: int) -> list:\n    totals = defaultdict(float)\n    for c, amt in orders:\n        totals[c] += amt\n    ranked = sorted(totals.items(), key=lambda kv: (-kv[1], kv[0]))\n    if len(ranked) <= n:\n        return ranked\n    cutoff = ranked[n - 1][1]\n    return [kv for kv in ranked if kv[1] >= cutoff]\n",
  "tests": "assert top_customers([('a', 5), ('b', 3), ('c', 3), ('a', 1)], 2) == [('a', 6), ('b', 3), ('c', 3)]\n",
  "hidden": "assert top_customers([], 3) == []\nassert top_customers([('x', 1)], 5) == [('x', 1)]\nassert top_customers([('a', 2), ('b', 2), ('c', 2)], 1) == [('a', 2), ('b', 2), ('c', 2)]\nassert top_customers([('a', 3), ('b', 2), ('c', 1)], 2) == [('a', 3), ('b', 2)]\n",
  "explanation": "Cutting at exactly n rows would drop a customer with the same total as the nth, which is arbitrary. Keeping everyone with a total ≥ the nth is the same idea as RANK() <= n in SQL."
}
```
