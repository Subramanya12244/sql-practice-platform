---
id: PY-086
title: LRU Cache Class
slug: lru-cache-class
difficulty: Medium
category: advanced
skill: performance
description: A fixed-size cache that evicts the least recently used key.
topic: python-oop
concepts: OrderedDict, classes, eviction
time: O(1) per get or put
space: O(capacity)
minutes: 15
---

## Scenario

A stream processor enriches events with customer profiles fetched from a slow service. Memory allows only a fixed number of profiles in cache, so the least recently used ones must be evicted.

## Problem

`LRUCache(capacity)` with `get(key)` (returns the value or None, and marks it recently used) and `put(key, value)` (inserts or updates, evicting the least recently used key when over capacity).

## Objective

Build an LRUCache with get and put that marks keys as recently used and evicts the least recently used key when over capacity.

## Input format

Keys and values.

## Output format

get returns a value or None.

## Constraints

- get and put must be O(1)
- capacity ≥ 1

## Examples

```
c = LRUCache(2); c.put('a', 1); c.put('b', 2); c.get('a'); c.put('c', 3); c.get('b')  ->  None
```

## Hints

- `collections.OrderedDict` keeps insertion order and has `move_to_end`.
- `popitem(last=False)` removes the oldest entry.

## Why it matters

Bounded caches keep enrichment fast without unbounded memory growth, and LRU is the default policy in most caching layers.

```task
{
  "id": "lru-cache-class",
  "title": "LRU Cache Class",
  "type": "python",
  "instructions": "`LRUCache(capacity)` with `get(key)` (returns the value or None, and marks it recently used) and `put(key, value)` (inserts or updates, evicting the least recently used key when over capacity).",
  "starter": "class LRUCache:\n    def __init__(self, capacity: int):\n        raise NotImplementedError\n",
  "solution": "from collections import OrderedDict\n\n\nclass LRUCache:\n    def __init__(self, capacity: int):\n        self.capacity = capacity\n        self.data = OrderedDict()\n\n    def get(self, key):\n        if key not in self.data:\n            return None\n        self.data.move_to_end(key)\n        return self.data[key]\n\n    def put(self, key, value) -> None:\n        self.data[key] = value\n        self.data.move_to_end(key)\n        if len(self.data) > self.capacity:\n            self.data.popitem(last=False)\n",
  "tests": "c = LRUCache(2)\nc.put('a', 1); c.put('b', 2)\nassert c.get('a') == 1\nc.put('c', 3)\nassert c.get('b') is None\nassert c.get('c') == 3\n",
  "hidden": "c = LRUCache(1)\nc.put('x', 1); c.put('x', 2)\nassert c.get('x') == 2\nc.put('y', 3)\nassert c.get('x') is None and c.get('y') == 3\nc = LRUCache(2)\nc.put('a', None)\nassert c.get('a') is None and 'a' in c.data\nc.put('b', 1); c.put('a', 5); c.put('c', 2)\nassert c.get('b') is None and c.get('a') == 5\n",
  "explanation": "An OrderedDict is a hash map plus a linked list: lookups are O(1), and moving a key to the end marks it as most recent. The front is always the least recently used key."
}
```
