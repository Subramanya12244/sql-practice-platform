---
id: PY-118
title: Bounded Top K Orders Per Category
slug: bounded-top-k-per-category
difficulty: Hard
category: dsa
skill: aggregation
description: Keep the k largest orders per category from an unbounded stream using O(k) memory per category.
topic: python-collections
concepts: heapq, bounded min-heap, streaming, tie-breaking
time: O(n log k)
space: O(c * k) for c categories
minutes: 30
---

## Scenario

The merchandising team wants a live leaderboard of the biggest orders in each product category. Orders arrive as an endless stream, so the job can never hold the full history in memory.

## Problem

Write `top_k_per_category(orders, k)`. `orders` is any iterable (possibly a generator) of dicts with `order_id`, `category` and `amount`. Return a dict mapping each category to a list of `(amount, order_id)` tuples for its k largest orders, sorted by amount descending. When two orders have the same amount the one that arrived earlier ranks higher and a later equal order never displaces an earlier one. Raise ValueError if k < 1. Each category may hold at most k orders in memory at any time.

## Objective

Implement a bounded per-key top-K with deterministic tie-breaking.

## Input format

An iterable of order dicts and an int k.

## Output format

dict[str, list[tuple[float, str]]].

## Constraints

- k >= 1 or ValueError
- Stream may be very long
- Ties: earlier arrival wins

## Examples

```
orders = [{'order_id':'o1','category':'toys','amount':10}, {'order_id':'o2','category':'toys','amount':30}, {'order_id':'o3','category':'toys','amount':20}]
top_k_per_category(orders, 2)  ->  {'toys': [(30, 'o2'), (20, 'o3')]}
```

## Hints

- Keep one min-heap per category so the smallest kept order is at heap[0].
- Store (amount, -sequence, order_id) so a later order with an equal amount compares as smaller.
- Only replace the root when the new tuple is strictly greater; sort at the end by (-amount, sequence).

## Why it matters

Leaderboards, heavy-hitter detection and 'top N per group' reports are everyday streaming jobs. Knowing how to bound memory with a size-k heap is what keeps such jobs from running out of memory on real volumes.

```task
{
  "id": "bounded-top-k-per-category",
  "title": "Bounded Top K Orders Per Category",
  "type": "python",
  "instructions": "Write `top_k_per_category(orders, k)`. `orders` is any iterable (possibly a generator) of dicts with `order_id`, `category` and `amount`. Return a dict mapping each category to a list of `(amount, order_id)` tuples for its k largest orders, sorted by amount descending. When two orders have the same amount the one that arrived earlier ranks higher and a later equal order never displaces an earlier one. Raise ValueError if k < 1. Each category may hold at most k orders in memory at any time.",
  "starter": "def top_k_per_category(orders, k: int) -> dict:\n    raise NotImplementedError\n",
  "solution": "import heapq\n\n\ndef top_k_per_category(orders, k: int) -> dict:\n    if k < 1:\n        raise ValueError(\"k must be >= 1\")\n    heaps = {}\n    for seq, o in enumerate(orders):\n        item = (o[\"amount\"], -seq, o[\"order_id\"])\n        h = heaps.setdefault(o[\"category\"], [])\n        if len(h) < k:\n            heapq.heappush(h, item)\n        elif item > h[0]:\n            heapq.heapreplace(h, item)\n    return {c: [(a, oid) for a, _, oid in sorted(h, key=lambda t: (-t[0], -t[1]))] for c, h in heaps.items()}\n",
  "tests": "orders = [{'order_id':'o1','category':'toys','amount':10}, {'order_id':'o2','category':'toys','amount':30}, {'order_id':'o3','category':'toys','amount':20}]\nassert top_k_per_category(orders, 2) == {'toys': [(30, 'o2'), (20, 'o3')]}\nassert top_k_per_category([], 3) == {}\n",
  "hidden": "o = [{'order_id':'a','category':'x','amount':5}, {'order_id':'b','category':'x','amount':5}, {'order_id':'c','category':'x','amount':5}]\nassert top_k_per_category(o, 2) == {'x': [(5, 'a'), (5, 'b')]}\no2 = [{'order_id':'a','category':'x','amount':5}, {'order_id':'b','category':'y','amount':1}, {'order_id':'c','category':'x','amount':9}]\nassert top_k_per_category(o2, 5) == {'x': [(9, 'c'), (5, 'a')], 'y': [(1, 'b')]}\ndef gen(n):\n    for i in range(n):\n        yield {'order_id': f'o{i}', 'category': 'c%d' % (i % 3), 'amount': (i * 7919) % 1000}\nr = top_k_per_category(gen(30000), 3)\nassert all(len(v) == 3 for v in r.values()) and r['c0'][0][0] == 999\nassert [a for a, _ in r['c1']] == sorted([a for a, _ in r['c1']], reverse=True)\ntry:\n    top_k_per_category([], 0)\n    raise AssertionError('expected ValueError')\nexcept ValueError:\n    pass\n",
  "explanation": "A min-heap of size k keeps the smallest retained order at the root, so each new order is compared against just one element. If it is larger it replaces the root in O(log k); otherwise it is discarded immediately. Encoding the arrival sequence as a negative number makes later equal amounts compare as smaller, which gives the earlier-wins rule for free. One heap per category bounds memory to k items per key no matter how long the stream is. The final sort only touches k items per category."
}
```
