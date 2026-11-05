---
id: PY-065
title: Allocate Stock To Orders FIFO
slug: fifo-stock-allocation
difficulty: Medium
category: dsa
skill: transformation
description: Fill orders from stock batches in first-in-first-out order with a deque.
topic: python-collections
concepts: deque, queue processing, partial fills
time: O(b + o)
space: O(b)
minutes: 20
---

## Scenario

A warehouse ships the oldest stock first. Each order consumes quantity from the oldest receipt batches, possibly spanning several batches.

## Problem

Write allocate(batches, orders). batches is a list of (batch_id, qty) oldest first; orders is a list of (order_id, qty). Process orders in order, taking from the oldest remaining batch. Return {'allocations': list of (order_id, batch_id, qty_taken), 'short': {order_id: missing_qty} for orders not fully filled}.

## Objective

Model a FIFO inventory queue with partial consumption.

## Input format

Two lists of tuples.

## Output format

dict with 'allocations' and 'short'.

## Constraints

- Batches with qty 0 are skipped
- Orders may be partially filled

## Examples

```
allocate([('b1',5),('b2',5)], [('o1',7),('o2',4)])
->  {'allocations':[('o1','b1',5),('o1','b2',2),('o2','b2',3)], 'short':{'o2':1}}
```

## Hints

- Put batches into a deque as mutable [id, qty] pairs.
- While the order still needs units and the deque is not empty, take min(need, front qty).

## Why it matters

FIFO allocation is how inventory valuation and cost-of-goods are computed in finance pipelines. A deque models the queue cleanly.

```task
{
  "id": "fifo-stock-allocation",
  "title": "Allocate Stock To Orders FIFO",
  "type": "python",
  "instructions": "Write allocate(batches, orders). batches is a list of (batch_id, qty) oldest first; orders is a list of (order_id, qty). Process orders in order, taking from the oldest remaining batch. Return {'allocations': list of (order_id, batch_id, qty_taken), 'short': {order_id: missing_qty} for orders not fully filled}.",
  "starter": "def allocate(batches: list, orders: list) -> dict:\n    raise NotImplementedError\n",
  "solution": "from collections import deque\n\ndef allocate(batches: list, orders: list) -> dict:\n    q = deque([b, n] for b, n in batches if n > 0)\n    allocs, short = [], {}\n    for oid, need in orders:\n        while need > 0 and q:\n            take = min(need, q[0][1])\n            allocs.append((oid, q[0][0], take))\n            need -= take\n            q[0][1] -= take\n            if q[0][1] == 0:\n                q.popleft()\n        if need > 0:\n            short[oid] = need\n    return {'allocations': allocs, 'short': short}\n",
  "tests": "assert allocate([('b1',5),('b2',5)], [('o1',7),('o2',4)]) == {'allocations':[('o1','b1',5),('o1','b2',2),('o2','b2',3)],'short':{'o2':1}}\nassert allocate([('b1',3)], [('o1',3)]) == {'allocations':[('o1','b1',3)],'short':{}}\n",
  "hidden": "assert allocate([], [('o1',2)]) == {'allocations':[],'short':{'o1':2}}\nassert allocate([('b1',2)], []) == {'allocations':[],'short':{}}\nassert allocate([('b0',0),('b1',1)], [('o',1)]) == {'allocations':[('o','b1',1)],'short':{}}\nassert allocate([('b1',1)], [('o1',0)]) == {'allocations':[],'short':{}}\nr=allocate([(f'b{i}',1) for i in range(5000)], [('big',4999),('x',2)])\nassert len(r['allocations'])==5000 and r['short']=={'x':1}\n",
  "explanation": "The deque holds remaining stock oldest first, so the front is always the next batch to consume. Each loop step takes as much as possible from the front and pops the batch when it is empty, giving amortised O(1) work per allocation. Whatever an order still needs once the queue is empty is recorded as a shortfall."
}
```
