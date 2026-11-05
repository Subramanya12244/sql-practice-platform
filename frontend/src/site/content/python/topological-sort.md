---
id: PY-149
title: Topological Sort With Cycle Detection
slug: topological-sort
difficulty: Hard
category: etl
skill: orchestration
description: Order tasks so dependencies come first.
topic: python-collections
concepts: Kahn's algorithm, in-degree, deterministic order
time: O((V + E) log V)
space: O(V + E)
minutes: 20
---

## Scenario

A nightly data platform runs dozens of jobs, each declaring which jobs it depends on. The scheduler needs a valid run order and must refuse to start if dependencies form a loop.

## Problem

`deps` maps task → list of tasks it depends on. Return an order where every task comes after its dependencies; among ready tasks pick the alphabetically smallest. Raise ValueError if there is a cycle.

## Objective

Return a dependency-respecting order picking the alphabetically smallest ready task, raising ValueError on a cycle.

## Input format

A dict of str → list[str].

## Output format

A list of all tasks.

## Constraints

- Dependencies may not be keys themselves

## Examples

```
topo_order({'deploy': ['build', 'test'], 'test': ['build'], 'build': []})  ->  ['build', 'test', 'deploy']
```

## Hints

- Count unmet dependencies per task; start with those at zero.
- A heap gives the smallest ready task; leftovers mean a cycle.

## Why it matters

Every orchestrator, from Airflow to dbt, is built on topological sorting, and understanding it explains how DAGs are scheduled and why cycles are rejected.

```task
{
  "id": "topological-sort",
  "title": "Topological Sort With Cycle Detection",
  "type": "python",
  "instructions": "`deps` maps task → list of tasks it depends on. Return an order where every task comes after its dependencies; among ready tasks pick the alphabetically smallest. Raise ValueError if there is a cycle.",
  "starter": "def topo_order(deps: dict) -> list:\n    raise NotImplementedError\n",
  "solution": "import heapq\n\n\ndef topo_order(deps: dict) -> list:\n    nodes = set(deps) | {d for ds in deps.values() for d in ds}\n    indeg = {n: 0 for n in nodes}\n    users = {n: [] for n in nodes}\n    for task, ds in deps.items():\n        for d in set(ds):\n            indeg[task] += 1\n            users[d].append(task)\n    ready = [n for n in nodes if indeg[n] == 0]\n    heapq.heapify(ready)\n    order = []\n    while ready:\n        n = heapq.heappop(ready)\n        order.append(n)\n        for u in users[n]:\n            indeg[u] -= 1\n            if indeg[u] == 0:\n                heapq.heappush(ready, u)\n    if len(order) != len(nodes):\n        raise ValueError('dependency cycle')\n    return order\n",
  "tests": "assert topo_order({'deploy': ['build', 'test'], 'test': ['build'], 'build': []}) == ['build', 'test', 'deploy']\n",
  "hidden": "assert topo_order({}) == []\nassert topo_order({'b': ['a']}) == ['a', 'b']\nassert topo_order({'c': [], 'a': [], 'b': []}) == ['a', 'b', 'c']\nassert topo_order({'x': ['y', 'y']}) == ['y', 'x']\ntry:\n    topo_order({'a': ['b'], 'b': ['a']})\n    raise AssertionError('expected ValueError')\nexcept ValueError:\n    pass\ntry:\n    topo_order({'a': ['a']})\n    raise AssertionError('expected ValueError')\nexcept ValueError:\n    pass\n",
  "explanation": "Kahn's algorithm repeatedly emits a task with no unmet dependencies. If tasks remain when nothing is ready, they depend on each other: a cycle. Deduplicating each task's dependency list keeps in-degrees correct."
}
```
