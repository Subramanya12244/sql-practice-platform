---
id: PY-109
title: Top K Products By Revenue With A Heap
slug: top-k-products-by-revenue
difficulty: Medium
category: dsa
skill: aggregation
description: Aggregate order lines and return the K best-selling products by revenue.
topic: python-collections
concepts: heapq.nlargest, aggregation, tie-break
time: O(n + s log k)
space: O(s)
minutes: 15
---

## Scenario

The merchandising dashboard shows the top products by revenue. The order line table has millions of rows, so a full sort of products is wasteful.

## Problem

Write top_products(lines, k). Each line is {'sku', 'qty', 'price'}. Sum qty*price per sku, then return the top k as a list of (sku, revenue) tuples, revenue rounded to 2 decimals, ordered by revenue desc then sku asc.

## Objective

Combine hash aggregation with a heap-based top-K selection.

## Input format

lines: list of dicts; k: int >= 0.

## Output format

list of (sku, revenue).

## Constraints

- k may exceed the number of skus
- Ties break by sku ascending

## Examples

```
[{'sku':'A','qty':2,'price':5},{'sku':'B','qty':1,'price':10},{'sku':'C','qty':1,'price':3}], 2  ->  [('A', 10), ('B', 10)]
```

## Hints

- First aggregate revenue per sku into a dict.
- A heap selection with key (-revenue, sku) handles both the ordering and the tie-break.

## Why it matters

Top-N reports are among the most common DE outputs. heapq.nlargest gives O(n log k) and avoids sorting the whole key space.

```task
{
  "id": "top-k-products-by-revenue",
  "title": "Top K Products By Revenue With A Heap",
  "type": "python",
  "instructions": "Write top_products(lines, k). Each line is {'sku', 'qty', 'price'}. Sum qty*price per sku, then return the top k as a list of (sku, revenue) tuples, revenue rounded to 2 decimals, ordered by revenue desc then sku asc.",
  "starter": "def top_products(lines: list, k: int) -> list:\n    raise NotImplementedError\n",
  "solution": "import heapq\n\ndef top_products(lines: list, k: int) -> list:\n    rev = {}\n    for l in lines:\n        rev[l['sku']] = rev.get(l['sku'], 0) + l['qty'] * l['price']\n    best = heapq.nsmallest(k, rev.items(), key=lambda kv: (-kv[1], kv[0]))\n    return [(s, round(r, 2)) for s, r in best]\n",
  "tests": "assert top_products([{'sku':'A','qty':2,'price':5},{'sku':'B','qty':1,'price':10},{'sku':'C','qty':1,'price':3}], 2) == [('A',10),('B',10)]\nassert top_products([{'sku':'A','qty':1,'price':1.105}], 5) == [('A',1.1)]\n",
  "hidden": "assert top_products([], 3) == []\nassert top_products([{'sku':'A','qty':1,'price':1}], 0) == []\nassert top_products([{'sku':'Z','qty':1,'price':2},{'sku':'Z','qty':1,'price':2},{'sku':'Y','qty':1,'price':3}], 1) == [('Z',4)]\nbig=[{'sku':f's{i%100:03d}','qty':1,'price':i%100} for i in range(10000)]\nassert top_products(big,2) == [('s099',9900),('s098',9800)]\n",
  "explanation": "A dict aggregates revenue per sku in one pass. nsmallest with key (-revenue, sku) selects the k best using a bounded heap, so ties fall back to sku ascending. The result is already ordered, and rounding is applied only at output to avoid compounding float error."
}
```
