---
id: PY-126
title: Deterministic Worker Pool Simulator
slug: simulated-worker-pool
difficulty: Hard
category: advanced
skill: orchestration
description: Simulate N workers pulling prioritised tasks over time, with arrivals and retries, and produce the exact execution timeline.
topic: python-collections
concepts: discrete-event simulation, priority queues, retries, determinism
time: O((n + r) log n) for n tasks and r retries
space: O(n)
minutes: 40
---

## Scenario

Before raising the warehouse loader's concurrency, the team wants to predict how long the nightly backlog takes with 2, 4 or 8 workers. Running real threads gives noisy answers, so they want a deterministic simulation.

## Problem

Write `simulate_pool(tasks, workers, max_retries=0)`. Each task has `id`, `duration`, `priority` (lower runs first), `arrival` and optional `fail_times` (how many of its first attempts fail). At each time step: first complete running tasks ending now (a failing attempt is retried by re-queueing it with arrival = now if attempts used <= max_retries, otherwise it is final 'failed'), then add arrived tasks to the ready queue, then give free workers (lowest worker id first) ready tasks ordered by (priority, arrival, id). Return `{'timeline': [(id, worker, start, end, outcome)], 'makespan': last end or 0, 'status': {id: 'ok' or 'failed'}}` with outcome 'ok', 'retry' or 'failed', and the timeline sorted by (start, worker). Raise ValueError if workers < 1. No threads or real time.

## Objective

Implement a deterministic discrete-event scheduler for a worker pool.

## Input format

A list of task dicts, a worker count and max retries.

## Output format

A dict with timeline, makespan and status.

## Constraints

- Durations and arrivals are non-negative ints
- Fully deterministic tie-breaking
- Idle time jumps straight to the next event

## Examples

```
tasks = [{'id': 'a', 'duration': 3, 'priority': 1, 'arrival': 0}, {'id': 'b', 'duration': 2, 'priority': 0, 'arrival': 0}, {'id': 'c', 'duration': 1, 'priority': 0, 'arrival': 1}]
simulate_pool(tasks, 2)['timeline']  ->  [('b', 0, 0, 2, 'ok'), ('a', 1, 0, 3, 'ok'), ('c', 0, 2, 3, 'ok')]
```

## Hints

- Use three heaps: ready (priority, arrival, id), running (end, worker, id, start) and free worker ids.
- Advance time to the minimum of the next completion and the next arrival.
- Keep a per-task counter of attempts and remaining failures.

## Why it matters

Capacity planning for pipelines is about how tasks queue on limited workers. A deterministic simulation shows how priorities, retries and concurrency affect makespan without the noise of real threads.

```task
{
  "id": "simulated-worker-pool",
  "title": "Deterministic Worker Pool Simulator",
  "type": "python",
  "instructions": "Write `simulate_pool(tasks, workers, max_retries=0)`. Each task has `id`, `duration`, `priority` (lower runs first), `arrival` and optional `fail_times` (how many of its first attempts fail). At each time step: first complete running tasks ending now (a failing attempt is retried by re-queueing it with arrival = now if attempts used <= max_retries, otherwise it is final 'failed'), then add arrived tasks to the ready queue, then give free workers (lowest worker id first) ready tasks ordered by (priority, arrival, id). Return `{'timeline': [(id, worker, start, end, outcome)], 'makespan': last end or 0, 'status': {id: 'ok' or 'failed'}}` with outcome 'ok', 'retry' or 'failed', and the timeline sorted by (start, worker). Raise ValueError if workers < 1. No threads or real time.",
  "starter": "def simulate_pool(tasks, workers: int, max_retries: int = 0) -> dict:\n    raise NotImplementedError\n",
  "solution": "import heapq\n\n\ndef simulate_pool(tasks, workers: int, max_retries: int = 0) -> dict:\n    if workers < 1:\n        raise ValueError(\"need at least one worker\")\n    info = {t[\"id\"]: t for t in tasks}\n    arrivals = sorted(tasks, key=lambda t: (t[\"arrival\"], t[\"id\"]))\n    fails = {t[\"id\"]: t.get(\"fail_times\", 0) for t in tasks}\n    attempts = {t[\"id\"]: 0 for t in tasks}\n    ready, running, free = [], [], list(range(workers))\n    timeline, status = [], {}\n    now, i = 0, 0\n    while True:\n        while running and running[0][0] == now:\n            end, w, tid, start = heapq.heappop(running)\n            attempts[tid] += 1\n            if fails[tid] > 0:\n                fails[tid] -= 1\n                if attempts[tid] <= max_retries:\n                    outcome = \"retry\"\n                    heapq.heappush(ready, (info[tid][\"priority\"], now, tid))\n                else:\n                    outcome = status[tid] = \"failed\"\n            else:\n                outcome = status[tid] = \"ok\"\n            timeline.append((tid, w, start, end, outcome))\n            heapq.heappush(free, w)\n        while i < len(arrivals) and arrivals[i][\"arrival\"] <= now:\n            t = arrivals[i]\n            heapq.heappush(ready, (t[\"priority\"], t[\"arrival\"], t[\"id\"]))\n            i += 1\n        while free and ready:\n            w = heapq.heappop(free)\n            _, _, tid = heapq.heappop(ready)\n            heapq.heappush(running, (now + info[tid][\"duration\"], w, tid, now))\n        nxt = [running[0][0]] if running else []\n        if i < len(arrivals):\n            nxt.append(arrivals[i][\"arrival\"])\n        if not nxt:\n            break\n        now = min(nxt)\n    timeline.sort(key=lambda r: (r[2], r[1]))\n    return {\"timeline\": timeline, \"makespan\": max((r[3] for r in timeline), default=0), \"status\": status}\n",
  "tests": "tasks = [{'id': 'a', 'duration': 3, 'priority': 1, 'arrival': 0}, {'id': 'b', 'duration': 2, 'priority': 0, 'arrival': 0}, {'id': 'c', 'duration': 1, 'priority': 0, 'arrival': 1}]\nr = simulate_pool(tasks, 2)\nassert r['timeline'] == [('b', 0, 0, 2, 'ok'), ('a', 1, 0, 3, 'ok'), ('c', 0, 2, 3, 'ok')]\nassert r['makespan'] == 3 and r['status'] == {'a': 'ok', 'b': 'ok', 'c': 'ok'}\n",
  "hidden": "tasks = [{'id': 'x', 'duration': 2, 'priority': 0, 'arrival': 0, 'fail_times': 1}, {'id': 'y', 'duration': 1, 'priority': 5, 'arrival': 0}]\nr = simulate_pool(tasks, 1, max_retries=1)\nassert r['timeline'] == [('x', 0, 0, 2, 'retry'), ('x', 0, 2, 4, 'ok'), ('y', 0, 4, 5, 'ok')] and r['makespan'] == 5\nr = simulate_pool(tasks, 1, max_retries=0)\nassert r['timeline'] == [('x', 0, 0, 2, 'failed'), ('y', 0, 2, 3, 'ok')] and r['status'] == {'x': 'failed', 'y': 'ok'}\nassert simulate_pool([], 3) == {'timeline': [], 'makespan': 0, 'status': {}}\nr = simulate_pool([{'id': 'late', 'duration': 2, 'priority': 0, 'arrival': 10}], 2)\nassert r['timeline'] == [('late', 0, 10, 12, 'ok')]\ntry:\n    simulate_pool([], 0)\n    raise AssertionError('expected ValueError')\nexcept ValueError:\n    pass\nmany = [{'id': f't{i:03d}', 'duration': 3, 'priority': 0, 'arrival': 0} for i in range(40)]\nassert simulate_pool(many, 1)['makespan'] == 120 and simulate_pool(many, 4)['makespan'] == 30 and simulate_pool(many, 64)['makespan'] == 3\nr = simulate_pool([{'id': 'z', 'duration': 0, 'priority': 0, 'arrival': 0}, {'id': 'w', 'duration': 1, 'priority': 1, 'arrival': 0}], 1)\nassert r['timeline'] == [('z', 0, 0, 0, 'ok'), ('w', 0, 0, 1, 'ok')]\n",
  "explanation": "A discrete-event simulation only visits moments where something changes: a completion or an arrival, so idle stretches cost nothing. Processing completions before arrivals and assignments at each moment makes the order of events at the same timestamp well defined. Heaps give the next completion, the highest-priority ready task and the lowest free worker in O(log n). A failed attempt is re-queued with its failure time as the new arrival until retries run out, which mirrors how real executors requeue tasks. Because every tie is broken explicitly, the same input always produces the same timeline, which makes capacity what-ifs reliable."
}
```
