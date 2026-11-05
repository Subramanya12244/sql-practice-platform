---
id: PY-081
title: Group Jobs Into Parallel Waves
slug: job-dependency-waves
difficulty: Medium
category: dsa
skill: orchestration
description: Group pipeline jobs into waves that can run in parallel given their dependencies.
topic: python-collections
concepts: Kahn's algorithm, in-degree, levels
time: O(V + E)
space: O(V + E)
minutes: 20
---

## Scenario

A nightly batch has dozens of jobs with upstream dependencies. The scheduler can run every job in a wave at once, so it needs jobs grouped by level.

## Problem

Write job_waves(deps). deps maps job -> list of jobs it depends on (dependencies may not appear as keys). Return a list of waves; wave 0 holds jobs with no dependencies, each later wave holds jobs whose dependencies are all in earlier waves. Sort jobs within a wave. Raise ValueError if there is a cycle.

## Objective

Compute topological levels with in-degree counting.

## Input format

dict of str -> list of str.

## Output format

list of sorted lists.

## Constraints

- Raise ValueError on cycles
- Duplicate dependencies count once

## Examples

```
{'load':['clean'],'clean':['extract'],'report':['load','extract']}  ->  [['extract'], ['clean'], ['load'], ['report']]
```

## Hints

- Count unmet dependencies per job and keep a reverse map of dependents.
- Process the current wave, decrement dependents, and collect those reaching zero as the next wave.
- If you place fewer jobs than exist, there is a cycle.

## Why it matters

Orchestrators like Airflow compute exactly this to decide what can run concurrently. Detecting cycles early prevents a stuck DAG.

```task
{
  "id": "job-dependency-waves",
  "title": "Group Jobs Into Parallel Waves",
  "type": "python",
  "instructions": "Write job_waves(deps). deps maps job -> list of jobs it depends on (dependencies may not appear as keys). Return a list of waves; wave 0 holds jobs with no dependencies, each later wave holds jobs whose dependencies are all in earlier waves. Sort jobs within a wave. Raise ValueError if there is a cycle.",
  "starter": "def job_waves(deps: dict) -> list:\n    raise NotImplementedError\n",
  "solution": "def job_waves(deps: dict) -> list:\n    nodes = set(deps)\n    for ds in deps.values():\n        nodes.update(ds)\n    indeg = {n: 0 for n in nodes}\n    children = {n: [] for n in nodes}\n    for job, ds in deps.items():\n        for d in set(ds):\n            indeg[job] += 1\n            children[d].append(job)\n    wave = sorted(n for n in nodes if indeg[n] == 0)\n    out, placed = [], 0\n    while wave:\n        out.append(wave)\n        placed += len(wave)\n        nxt = []\n        for n in wave:\n            for c in children[n]:\n                indeg[c] -= 1\n                if indeg[c] == 0:\n                    nxt.append(c)\n        wave = sorted(nxt)\n    if placed != len(nodes):\n        raise ValueError('cycle')\n    return out\n",
  "tests": "assert job_waves({'load':['clean'],'clean':['extract'],'report':['load','extract']}) == [['extract'],['clean'],['load'],['report']]\nassert job_waves({'a':[],'b':[],'c':['a','b']}) == [['a','b'],['c']]\n",
  "hidden": "assert job_waves({}) == []\nassert job_waves({'x':['y','y']}) == [['y'],['x']]\ntry:\n    job_waves({'a':['b'],'b':['a']}); assert False\nexcept ValueError:\n    pass\ntry:\n    job_waves({'a':['a']}); assert False\nexcept ValueError:\n    pass\nd={f'j{i:03d}':[f'j{i-1:03d}'] if i else [] for i in range(300)}\nassert len(job_waves(d)) == 300\n",
  "explanation": "Kahn's algorithm repeatedly removes jobs with no unmet dependencies. Processing a whole frontier at a time yields levels instead of a flat order, and each job lands in the earliest wave its dependencies allow. Deduplicating dependencies keeps in-degrees correct. Any job left with nonzero in-degree means a cycle, which the placed count detects."
}
```
