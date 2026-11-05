---
id: PY-150
title: Tumbling Windows With Watermarks
slug: watermark-tumbling-windows
difficulty: Hard
category: advanced
skill: streaming
description: Aggregate out-of-order events into event-time tumbling windows that close when the watermark passes, routing too-late events aside.
topic: python-oop
concepts: event time, watermarks, allowed lateness, stateful streaming
time: O(W log W) per emission
space: O(open windows + late events)
minutes: 40
---

## Scenario

A click-stream job computes per-page counts every minute of event time. Mobile clients buffer events and send them late, so the job must wait a bit for stragglers but cannot keep windows open forever.

## Problem

Implement class `TumblingWindows(size, lateness)`. `add(event_time, key, value)` (times are ints, seconds) assigns the event to window `[start, start + size)` with `start = event_time - event_time % size`. The watermark is `max event time seen - lateness`. If the event's window end is <= the current watermark, the window is already closed: append `(event_time, key, value)` to `self.late` and return []. Otherwise accumulate sum and count per (window start, key), update the watermark, and return all windows whose end is now <= watermark as `(start, key, sum, count)` tuples sorted by (start, key). Each window is emitted once. `flush()` emits every remaining open window in the same format. `watermark` is a property (None before the first event).

## Objective

Implement event-time windowing with watermarks and late-data handling.

## Input format

Calls to add with int times, keys and numeric values.

## Output format

Lists of closed window tuples; a late list.

## Constraints

- Events may arrive out of order
- A late event never reopens a window
- Emission order (start, key)

## Examples

```
w = TumblingWindows(60, 10)
w.add(5, 'home', 1)  ->  []
w.add(50, 'home', 1)  ->  []
w.add(71, 'cart', 1)  ->  [(0, 'home', 2, 2)]
```

## Hints

- Store open windows in a dict {(start, key): [sum, count]}.
- The late check uses the watermark before the event updates it.
- After updating max time, pop every window with start + size <= watermark.

## Why it matters

Flink, Spark Structured Streaming and Beam all use watermarks to decide when an event-time window is complete. Building it by hand makes the trade-off between latency and completeness concrete.

```task
{
  "id": "watermark-tumbling-windows",
  "title": "Tumbling Windows With Watermarks",
  "type": "python",
  "instructions": "Implement class `TumblingWindows(size, lateness)`. `add(event_time, key, value)` (times are ints, seconds) assigns the event to window `[start, start + size)` with `start = event_time - event_time % size`. The watermark is `max event time seen - lateness`. If the event's window end is <= the current watermark, the window is already closed: append `(event_time, key, value)` to `self.late` and return []. Otherwise accumulate sum and count per (window start, key), update the watermark, and return all windows whose end is now <= watermark as `(start, key, sum, count)` tuples sorted by (start, key). Each window is emitted once. `flush()` emits every remaining open window in the same format. `watermark` is a property (None before the first event).",
  "starter": "class TumblingWindows:\n    def __init__(self, size, lateness):\n        raise NotImplementedError\n",
  "solution": "class TumblingWindows:\n    def __init__(self, size, lateness):\n        self.size, self.lateness = size, lateness\n        self._max = None\n        self._open = {}\n        self.late = []\n\n    @property\n    def watermark(self):\n        return None if self._max is None else self._max - self.lateness\n\n    def _pop(self, pred):\n        keys = sorted(k for k in self._open if pred(k))\n        return [(s, k, *self._open.pop((s, k))) for s, k in keys]\n\n    def add(self, event_time, key, value):\n        start = event_time - event_time % self.size\n        wm = self.watermark\n        if wm is not None and start + self.size <= wm:\n            self.late.append((event_time, key, value))\n            return []\n        acc = self._open.setdefault((start, key), [0, 0])\n        acc[0] += value\n        acc[1] += 1\n        self._max = event_time if self._max is None else max(self._max, event_time)\n        wm = self.watermark\n        return self._pop(lambda k: k[0] + self.size <= wm)\n\n    def flush(self):\n        return self._pop(lambda k: True)\n",
  "tests": "w = TumblingWindows(60, 10)\nassert w.add(5, 'home', 1) == []\nassert w.add(50, 'home', 1) == []\nassert w.add(71, 'cart', 1) == [(0, 'home', 2, 2)]\nassert w.watermark == 61\n",
  "hidden": "w = TumblingWindows(10, 5)\nassert w.watermark is None\nassert w.add(12, 'a', 2) == []\nassert w.add(3, 'b', 1) == []\nassert w.add(14, 'a', 3) == []\nassert w.add(16, 'b', 4) == [(0, 'b', 1, 1)]\nassert w.add(8, 'a', 9) == [] and w.late == [(8, 'a', 9)]\nassert w.add(19, 'a', 1) == []\nassert w.add(40, 'c', 1) == [(10, 'a', 6, 3), (10, 'b', 4, 1)]\nassert w.add(36, 'c', 1) == []\nassert w.flush() == [(30, 'c', 1, 1), (40, 'c', 1, 1)]\nassert w.flush() == []\nz = TumblingWindows(5, 0)\nout = []\nfor t in range(100):\n    out += z.add(t, 'k', 1)\nout += z.flush()\nassert len(out) == 20 and all(c == 5 for _, _, _, c in out) and z.late == []\n",
  "explanation": "Each event is assigned to a window by event time, not arrival time, so out-of-order data lands in the right bucket. The watermark trails the maximum event time by the allowed lateness and acts as the job's statement that no earlier data is expected. A window is emitted exactly once, when the watermark passes its end, and then removed from state, which keeps memory bounded. Events for windows that already closed go to a late list instead of silently changing published results. flush() drains remaining state at end of stream, which is what a bounded replay or shutdown needs."
}
```
