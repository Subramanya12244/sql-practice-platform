---
id: PY-123
title: DAG Runner With Upstream Failure Propagation
slug: dag-runner-upstream-failed
difficulty: Hard
category: etl
skill: orchestration
description: Execute a task DAG in dependency order, passing upstream results downstream and skipping tasks whose upstream failed.
topic: python-etl-pipelines
concepts: topological execution, failure propagation, passing results between tasks
time: O((V + E) log V)
space: O(V + E)
minutes: 35
---

## Scenario

A mini orchestrator runs the nightly marketing pipeline. When the ad-spend extract fails, its reports must be skipped, but unrelated branches such as the CRM load should still finish.

## Problem

Write `run_dag(deps, actions)`. `deps` maps task to its list of upstream tasks and `actions` maps task to a callable taking one argument: a dict `{upstream_task: upstream_result}`. Run tasks in topological order, always choosing the alphabetically smallest ready task. A task whose upstreams all succeeded is executed; if it returns, its status is 'success' and its result is stored, and if it raises, its status is 'failed'. A task with any non-successful upstream is not executed and gets 'upstream_failed'. Raise ValueError for cycles or unknown upstream names (before running anything). Return `{'order': tasks actually executed, 'status': {task: status}, 'results': {task: result for successes}}`.

## Objective

Implement orchestrator semantics: ordering, data hand-off and blast-radius control.

## Input format

A deps dict and an actions dict with the same keys.

## Output format

A dict with order, status and results.

## Constraints

- Validate the whole graph before executing
- Ready ties broken alphabetically
- Exceptions from actions never escape

## Examples

```
deps = {'extract': [], 'clean': ['extract'], 'report': ['clean']}
actions: extract -> [1, 2, 3], clean -> sum of extract, report -> raises
-> order ['extract', 'clean', 'report'], status report 'failed', results {'extract': [1, 2, 3], 'clean': 6}
```

## Hints

- Kahn's algorithm with a heap of ready task names; run the cycle check first by doing a dry topological pass.
- When a task is popped, look at its upstream statuses to decide run or skip.
- Skipped tasks still release their children so the walk reaches every task.

## Why it matters

Airflow's trigger rules and upstream_failed state exist because one failure should not kill unrelated branches. Implementing the scheduling loop clarifies how orchestrators decide what runs and what is skipped.

```task
{
  "id": "dag-runner-upstream-failed",
  "title": "DAG Runner With Upstream Failure Propagation",
  "type": "python",
  "instructions": "Write `run_dag(deps, actions)`. `deps` maps task to its list of upstream tasks and `actions` maps task to a callable taking one argument: a dict `{upstream_task: upstream_result}`. Run tasks in topological order, always choosing the alphabetically smallest ready task. A task whose upstreams all succeeded is executed; if it returns, its status is 'success' and its result is stored, and if it raises, its status is 'failed'. A task with any non-successful upstream is not executed and gets 'upstream_failed'. Raise ValueError for cycles or unknown upstream names (before running anything). Return `{'order': tasks actually executed, 'status': {task: status}, 'results': {task: result for successes}}`.",
  "starter": "def run_dag(deps: dict, actions: dict) -> dict:\n    raise NotImplementedError\n",
  "solution": "import heapq\n\n\ndef _order(deps):\n    indeg = {t: len(ds) for t, ds in deps.items()}\n    children = {t: [] for t in deps}\n    for t, ds in deps.items():\n        for d in ds:\n            if d not in deps:\n                raise ValueError(f\"unknown upstream {d}\")\n            children[d].append(t)\n    heap = [t for t, n in indeg.items() if n == 0]\n    heapq.heapify(heap)\n    out = []\n    while heap:\n        t = heapq.heappop(heap)\n        out.append(t)\n        for c in children[t]:\n            indeg[c] -= 1\n            if indeg[c] == 0:\n                heapq.heappush(heap, c)\n    if len(out) != len(deps):\n        raise ValueError(\"cycle detected\")\n    return out\n\n\ndef run_dag(deps: dict, actions: dict) -> dict:\n    order, status, results = [], {}, {}\n    for t in _order(deps):\n        if any(status[d] != \"success\" for d in deps[t]):\n            status[t] = \"upstream_failed\"\n            continue\n        order.append(t)\n        try:\n            results[t] = actions[t]({d: results[d] for d in deps[t]})\n            status[t] = \"success\"\n        except Exception:\n            status[t] = \"failed\"\n    return {\"order\": order, \"status\": status, \"results\": results}\n",
  "tests": "deps = {'extract': [], 'clean': ['extract'], 'report': ['clean']}\ndef bad(_):\n    raise RuntimeError('quota')\nactions = {'extract': lambda u: [1, 2, 3], 'clean': lambda u: sum(u['extract']), 'report': bad}\nr = run_dag(deps, actions)\nassert r['order'] == ['extract', 'clean', 'report']\nassert r['status'] == {'extract': 'success', 'clean': 'success', 'report': 'failed'}\nassert r['results'] == {'extract': [1, 2, 3], 'clean': 6}\n",
  "hidden": "def bad(_):\n    raise RuntimeError('x')\ndeps = {'ads': [], 'crm': [], 'ads_report': ['ads'], 'crm_load': ['crm'], 'exec_dash': ['ads_report', 'crm_load'], 'ads_alert': ['ads_report']}\nran = []\ndef mk(name):\n    def f(up):\n        ran.append(name)\n        return name.upper()\n    return f\nacts = {k: mk(k) for k in deps}\nacts['ads'] = bad\nr = run_dag(deps, acts)\nassert r['order'] == ['ads', 'crm', 'crm_load']\nassert r['status'] == {'ads': 'failed', 'crm': 'success', 'crm_load': 'success', 'ads_report': 'upstream_failed', 'ads_alert': 'upstream_failed', 'exec_dash': 'upstream_failed'}\nassert ran == ['crm', 'crm_load']\nran.clear()\ntry:\n    run_dag({'a': ['b'], 'b': ['a'], 'c': []}, {'a': bad, 'b': bad, 'c': mk('c')})\n    raise AssertionError('expected ValueError')\nexcept ValueError:\n    pass\nassert ran == []\ntry:\n    run_dag({'a': ['zzz']}, {'a': bad})\n    raise AssertionError('expected ValueError')\nexcept ValueError:\n    pass\nassert run_dag({}, {}) == {'order': [], 'status': {}, 'results': {}}\nr = run_dag({'b': [], 'a': [], 'c': ['a', 'b']}, {'a': lambda u: 1, 'b': lambda u: 2, 'c': lambda u: u})\nassert r['order'] == ['a', 'b', 'c'] and r['results']['c'] == {'a': 1, 'b': 2}\n",
  "explanation": "Computing the full topological order up front validates the graph, so a cycle or typo is reported before any side effects run. Walking that order guarantees each task's upstream statuses are final when it is considered. A task runs only if every upstream succeeded, otherwise it is marked upstream_failed, which propagates naturally to all descendants. Unrelated branches are unaffected because their upstreams succeed. Passing a dict of upstream results gives tasks explicit inputs instead of shared global state."
}
```
