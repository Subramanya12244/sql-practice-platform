---
id: PY-128
title: Find A Cycle In A Directed Graph
slug: cycle-detect-directed
difficulty: Hard
category: dsa
skill: orchestration
description: Return an actual cycle, not just yes/no.
topic: python-collections
concepts: DFS colouring, iterative DFS, path recovery
time: O(V log V + E log E)
space: O(V + E)
minutes: 25
---

## Scenario

A data platform lets teams declare which tables each job depends on. Before deploying, the scheduler must reject any configuration where jobs depend on each other in a loop, and show which jobs form that loop.

## Problem

`graph` maps node → list of successors. Return a list of nodes forming a cycle (starting and ending with the same node, e.g. ['a', 'b', 'a']) or None if the graph is acyclic. Explore nodes and successors in sorted order so the result is deterministic. Use iteration so deep graphs work.

## Objective

Return a list of nodes forming a cycle in the directed graph, or None if it is acyclic, exploring in sorted order iteratively.

## Input format

An adjacency dict.

## Output format

A list or None.

## Constraints

- Up to 100 000 nodes

## Examples

```
find_cycle({'a': ['b'], 'b': ['c'], 'c': ['a']})  ->  ['a', 'b', 'c', 'a']
```

## Hints

- White/grey/black colouring: reaching a grey node means a back edge (a cycle).
- Keep the current DFS path to read the cycle off it.

## Why it matters

Dependency loops make a DAG impossible to schedule, and pointing to the exact cycle turns a vague deploy failure into a fix the team can act on.

```task
{
  "id": "cycle-detect-directed",
  "title": "Find A Cycle In A Directed Graph",
  "type": "python",
  "instructions": "`graph` maps node → list of successors. Return a list of nodes forming a cycle (starting and ending with the same node, e.g. ['a', 'b', 'a']) or None if the graph is acyclic. Explore nodes and successors in sorted order so the result is deterministic. Use iteration so deep graphs work.",
  "starter": "def find_cycle(graph: dict):\n    raise NotImplementedError\n",
  "solution": "def find_cycle(graph: dict):\n    nodes = sorted(set(graph) | {v for vs in graph.values() for v in vs})\n    state = {}\n    for root in nodes:\n        if root in state:\n            continue\n        path, pos = [root], {root: 0}\n        state[root] = 1\n        stack = [iter(sorted(graph.get(root, [])))]\n        while stack:\n            nxt = next(stack[-1], None)\n            if nxt is None:\n                done = path.pop()\n                del pos[done]\n                state[done] = 2\n                stack.pop()\n                continue\n            if state.get(nxt) == 1:\n                return path[pos[nxt]:] + [nxt]\n            if nxt not in state:\n                state[nxt] = 1\n                pos[nxt] = len(path)\n                path.append(nxt)\n                stack.append(iter(sorted(graph.get(nxt, []))))\n    return None\n",
  "tests": "assert find_cycle({'a': ['b'], 'b': ['c'], 'c': ['a']}) == ['a', 'b', 'c', 'a']\nassert find_cycle({'a': ['b'], 'b': []}) is None\n",
  "hidden": "assert find_cycle({}) is None\nassert find_cycle({'x': ['x']}) == ['x', 'x']\nassert find_cycle({'a': ['b', 'c'], 'b': ['d'], 'c': ['d'], 'd': []}) is None\nassert find_cycle({'a': ['b'], 'b': ['c'], 'c': ['b']}) == ['b', 'c', 'b']\nchain = {i: [i + 1] for i in range(100000)}\nassert find_cycle(chain) is None\nchain[99999] = [50000]\nc = find_cycle(chain)\nassert c[0] == c[-1] == 50000 and len(c) == 50001\n",
  "explanation": "A node is grey while it's on the current DFS path; an edge to a grey node closes a loop, and the path from that node onward is the cycle. Iterators on an explicit stack replace recursion, so a 100 000-node chain doesn't overflow."
}
```
