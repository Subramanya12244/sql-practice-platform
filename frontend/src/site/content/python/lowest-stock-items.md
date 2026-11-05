---
id: PY-043
title: Lowest Stock Items
slug: lowest-stock-items
difficulty: Easy
category: dsa
skill: aggregation
description: Find the k products with the lowest stock for a restock report.
topic: python-modules-packages
concepts: heapq.nsmallest, key functions
time: O(n log k)
space: O(k)
minutes: 6
---

## Scenario

The warehouse team wants a morning report of the k products closest to running out.

## Problem

Write `lowest_stock(items, k)` where items are dicts with 'sku' and 'stock'. Return the k skus with the smallest stock, ordered by stock then sku. k <= 0 returns [].

## Objective

Return the k skus with the lowest stock, breaking ties by sku, without sorting the whole list.

## Input format

A list of dicts and an int k.

## Output format

A list of sku strings.

## Constraints

- k larger than len returns all

## Examples

```
lowest_stock([{'sku': 'a', 'stock': 5}, {'sku': 'b', 'stock': 1}, {'sku': 'c', 'stock': 3}], 2)  ->  ['b', 'c']
```

## Hints

- heapq.nsmallest accepts a key function.
- Use a tuple key (stock, sku) for ties.

## Why it matters

Bottom-K and top-K reports are common, and a heap avoids sorting the whole dataset. This scales when the inventory list is large.

```task
{
  "id": "lowest-stock-items",
  "title": "Lowest Stock Items",
  "type": "python",
  "instructions": "Write `lowest_stock(items, k)` where items are dicts with 'sku' and 'stock'. Return the k skus with the smallest stock, ordered by stock then sku. k <= 0 returns [].",
  "starter": "def lowest_stock(items, k):\n    raise NotImplementedError\n",
  "solution": "import heapq\n\ndef lowest_stock(items, k):\n    if k <= 0:\n        return []\n    return [i['sku'] for i in heapq.nsmallest(k, items, key=lambda i: (i['stock'], i['sku']))]\n",
  "tests": "assert lowest_stock([{'sku': 'a', 'stock': 5}, {'sku': 'b', 'stock': 1}, {'sku': 'c', 'stock': 3}], 2) == ['b', 'c']\n",
  "hidden": "assert lowest_stock([], 3) == []\nassert lowest_stock([{'sku': 'a', 'stock': 1}], 0) == []\nassert lowest_stock([{'sku': 'z', 'stock': 2}, {'sku': 'y', 'stock': 2}], 5) == ['y', 'z']\nassert lowest_stock([{'sku': str(i), 'stock': i} for i in range(10000)], 3) == ['0', '1', '2']\n",
  "explanation": "nsmallest keeps a heap of size k, so it is cheaper than a full sort when k is small. The tuple key makes ties deterministic by sku."
}
```
