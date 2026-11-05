---
id: PY-141
title: Priority Event Scheduler
slug: event-scheduler
difficulty: Hard
category: etl
skill: orchestration
description: A scheduler that runs events by time and priority, with cancellation.
topic: python-oop
concepts: heapq, stable ordering, cancellation
time: O(log n) per schedule, O(k log n) per run_until
space: O(n)
minutes: 25
---

## Scenario

A pipeline runner keeps a queue of jobs scheduled at given times with priorities, and operators can cancel jobs before they run. At each tick it must release the due jobs in a predictable order.

## Problem

`schedule(at, priority, name)` returns an id; `cancel(id)` removes an event (False if unknown); `run_until(t)` returns names of events with at ≤ t in order of (at, priority ascending, insertion order) and removes them.

## Objective

Build a Scheduler with schedule, cancel and run_until that returns due event names ordered by time, priority and insertion.

## Input format

Times, priorities and names.

## Output format

Lists of names.

## Constraints

- Cancellation must be O(log n) or better amortised

## Examples

```
s = Scheduler(); s.schedule(5, 1, 'b'); s.schedule(5, 0, 'a'); s.run_until(5)  ->  ['a', 'b']
```

## Hints

- Heap entries (at, priority, counter, id); the counter keeps insertion order.
- Cancel lazily: mark ids and skip them when popped.

## Why it matters

A heap-based scheduler with lazy cancellation is the core of job runners and timers, and deterministic ordering makes their behaviour reproducible.

```task
{
  "id": "event-scheduler",
  "title": "Priority Event Scheduler",
  "type": "python",
  "instructions": "`schedule(at, priority, name)` returns an id; `cancel(id)` removes an event (False if unknown); `run_until(t)` returns names of events with at ≤ t in order of (at, priority ascending, insertion order) and removes them.",
  "starter": "class Scheduler:\n    def __init__(self):\n        raise NotImplementedError\n",
  "solution": "import heapq\nimport itertools\n\n\nclass Scheduler:\n    def __init__(self):\n        self.heap = []\n        self.names = {}\n        self.ids = itertools.count(1)\n\n    def schedule(self, at, priority, name) -> int:\n        eid = next(self.ids)\n        self.names[eid] = name\n        heapq.heappush(self.heap, (at, priority, eid))\n        return eid\n\n    def cancel(self, eid: int) -> bool:\n        return self.names.pop(eid, None) is not None\n\n    def run_until(self, t) -> list:\n        out = []\n        while self.heap and self.heap[0][0] <= t:\n            _, _, eid = heapq.heappop(self.heap)\n            name = self.names.pop(eid, None)\n            if name is not None:\n                out.append(name)\n        return out\n",
  "tests": "s = Scheduler()\ns.schedule(5, 1, 'b'); s.schedule(5, 0, 'a')\nassert s.run_until(5) == ['a', 'b']\n",
  "hidden": "s = Scheduler()\nx = s.schedule(1, 0, 'x')\ns.schedule(1, 0, 'y'); s.schedule(1, 0, 'z'); s.schedule(9, 0, 'late')\nassert s.cancel(x) is True and s.cancel(x) is False and s.cancel(999) is False\nassert s.run_until(3) == ['y', 'z']\nassert s.run_until(3) == []\nassert s.run_until(100) == ['late']\nids = [s.schedule(i % 10, 0, str(i)) for i in range(5000)]\nfor i in ids[::2]:\n    s.cancel(i)\nassert len(s.run_until(10)) == 2500\n",
  "explanation": "The heap orders by (time, priority); a monotonically increasing id breaks remaining ties by insertion order. Lazy cancellation just forgets the id, and popped entries without a name are skipped: O(1) cancel, amortised O(log n) run."
}
```
