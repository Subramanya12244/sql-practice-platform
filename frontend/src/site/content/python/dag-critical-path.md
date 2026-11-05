---
id: PY-138
title: Pipeline DAG Critical Path
slug: dag-critical-path
difficulty: Hard
category: dsa
skill: orchestration
description: Compute makespan, execution levels and the critical path of a task DAG.
topic: python-etl-pipelines
concepts: DAG, Kahn's algorithm, longest path, cycle detection
time: O(V + E)
space: O(V + E)
minutes: 35
---

## Scenario

The nightly warehouse load is a DAG of extract, staging and mart jobs with known average runtimes. The platform team needs to know which chain of jobs decides when the marts are ready so they can optimise the right jobs.

## Problem

Write `critical_path(tasks)`. `tasks` maps task name to `(duration, [dependencies])`. Assuming unlimited parallelism, return a dict with `makespan` (earliest finish of the whole DAG), `levels` (list of lists: level 0 holds tasks with no dependencies, level n holds tasks whose deepest dependency is at level n-1, each level sorted) and `path` (the critical path from a root to the task that finishes last). When several tasks tie for latest finish pick the alphabetically smallest, and when walking back pick the dependency with the largest finish, ties alphabetically smallest. Raise ValueError on a cycle or on a dependency that is not a task.

## Objective

Combine topological ordering with longest-path computation and path reconstruction.

## Input format

dict[str, tuple[int, list[str]]].

## Output format

{'makespan': int, 'levels': list[list[str]], 'path': list[str]}.

## Constraints

- Durations are non-negative ints
- Empty dict gives makespan 0, levels [], path []

## Examples

```
critical_path({'extract': (2, []), 'stage': (3, ['extract']), 'dim': (1, ['extract']), 'mart': (2, ['stage', 'dim'])})
->  {'makespan': 7, 'levels': [['extract'], ['dim', 'stage'], ['mart']], 'path': ['extract', 'stage', 'mart']}
```

## Hints

- Process tasks in topological order (Kahn's algorithm); leftover tasks mean a cycle.
- finish[t] = duration[t] + max(finish of deps), level[t] = 1 + max(level of deps).
- Walk back from the last-finishing task, always choosing the dependency that finishes last.

## Why it matters

Orchestrators like Airflow and Dagster expose exactly this view: what can run in parallel and which chain bounds the SLA. Computing it yourself teaches where pipeline latency really comes from.

```task
{
  "id": "dag-critical-path",
  "title": "Pipeline DAG Critical Path",
  "type": "python",
  "instructions": "Write `critical_path(tasks)`. `tasks` maps task name to `(duration, [dependencies])`. Assuming unlimited parallelism, return a dict with `makespan` (earliest finish of the whole DAG), `levels` (list of lists: level 0 holds tasks with no dependencies, level n holds tasks whose deepest dependency is at level n-1, each level sorted) and `path` (the critical path from a root to the task that finishes last). When several tasks tie for latest finish pick the alphabetically smallest, and when walking back pick the dependency with the largest finish, ties alphabetically smallest. Raise ValueError on a cycle or on a dependency that is not a task.",
  "starter": "def critical_path(tasks: dict) -> dict:\n    raise NotImplementedError\n",
  "solution": "from collections import deque\n\n\ndef critical_path(tasks: dict) -> dict:\n    indeg = {t: 0 for t in tasks}\n    children = {t: [] for t in tasks}\n    for t, (_, deps) in tasks.items():\n        for d in deps:\n            if d not in tasks:\n                raise ValueError(f\"unknown dependency {d}\")\n            indeg[t] += 1\n            children[d].append(t)\n    q = deque(sorted(t for t in tasks if indeg[t] == 0))\n    finish, level, order = {}, {}, []\n    while q:\n        t = q.popleft()\n        order.append(t)\n        dur, deps = tasks[t]\n        finish[t] = dur + max((finish[d] for d in deps), default=0)\n        level[t] = 1 + max((level[d] for d in deps), default=-1)\n        for c in children[t]:\n            indeg[c] -= 1\n            if indeg[c] == 0:\n                q.append(c)\n    if len(order) != len(tasks):\n        raise ValueError(\"cycle detected\")\n    if not tasks:\n        return {\"makespan\": 0, \"levels\": [], \"path\": []}\n    levels = [[] for _ in range(max(level.values()) + 1)]\n    for t, lv in level.items():\n        levels[lv].append(t)\n    last = min(tasks, key=lambda t: (-finish[t], t))\n    path = [last]\n    while tasks[path[-1]][1]:\n        path.append(min(tasks[path[-1]][1], key=lambda d: (-finish[d], d)))\n    return {\"makespan\": finish[last], \"levels\": [sorted(l) for l in levels], \"path\": path[::-1]}\n",
  "tests": "r = critical_path({'extract': (2, []), 'stage': (3, ['extract']), 'dim': (1, ['extract']), 'mart': (2, ['stage', 'dim'])})\nassert r == {'makespan': 7, 'levels': [['extract'], ['dim', 'stage'], ['mart']], 'path': ['extract', 'stage', 'mart']}\nassert critical_path({}) == {'makespan': 0, 'levels': [], 'path': []}\n",
  "hidden": "try:\n    critical_path({'a': (1, ['b']), 'b': (1, ['a'])})\n    raise AssertionError('expected ValueError')\nexcept ValueError:\n    pass\ntry:\n    critical_path({'a': (1, ['ghost'])})\n    raise AssertionError('expected ValueError')\nexcept ValueError:\n    pass\nr = critical_path({'a': (5, []), 'b': (5, [])})\nassert r['makespan'] == 5 and r['path'] == ['a'] and r['levels'] == [['a', 'b']]\nr = critical_path({'a': (1, []), 'b': (10, []), 'c': (1, ['a', 'b']), 'd': (2, ['a'])})\nassert r['path'] == ['b', 'c'] and r['makespan'] == 11 and r['levels'] == [['a', 'b'], ['c', 'd']]\ntasks = {f't{i}': (1, [f't{i-1}'] if i else []) for i in range(500)}\nr = critical_path(tasks)\nassert r['makespan'] == 500 and len(r['path']) == 500 and len(r['levels']) == 500\n",
  "explanation": "Kahn's algorithm yields a topological order and doubles as cycle detection: any task never reaching in-degree zero sits on a cycle. Visiting tasks in that order guarantees every dependency's finish time and level are known before the task itself. The earliest finish of a task is its duration plus the latest finish among its dependencies, which is the longest path to it. The critical path is rebuilt by walking back from the last-finishing task through the dependency that finishes latest. Deterministic tie-breaking keeps the output stable across runs."
}
```
