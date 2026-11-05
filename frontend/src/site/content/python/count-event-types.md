---
id: PY-030
title: Count Event Types
slug: count-event-types
difficulty: Easy
category: fundamentals
skill: aggregation
description: Count how many times each event type appears in a clickstream.
topic: python-collections
concepts: dict counting, loops
time: O(n)
space: O(k)
minutes: 5
---

## Scenario

Product analytics receives a list of app events and needs a quick count per event type for a daily health check.

## Problem

Write `count_events(events)` taking a list of dicts with an 'type' key and returning a dict mapping each type to its count. Events missing 'type' or with a None type are counted under 'unknown'.

## Objective

Build a per-type event count where missing or None types are grouped under 'unknown'.

## Input format

A list of event dicts.

## Output format

A dict of type -> count.

## Constraints

- Empty list returns {}

## Examples

```
count_events([{'type': 'click'}, {'type': 'view'}, {'type': 'click'}])  ->  {'click': 2, 'view': 1}
```

## Hints

- Use dict.get(key, 0) + 1 to increment.
- Use e.get('type') or 'unknown' for missing values.

## Why it matters

Counting by key is the simplest aggregation and the first sanity check on any new event feed. Handling missing keys stops one bad event from breaking the job.

```task
{
  "id": "count-event-types",
  "title": "Count Event Types",
  "type": "python",
  "instructions": "Write `count_events(events)` taking a list of dicts with an 'type' key and returning a dict mapping each type to its count. Events missing 'type' or with a None type are counted under 'unknown'.",
  "starter": "def count_events(events):\n    raise NotImplementedError\n",
  "solution": "def count_events(events):\n    counts = {}\n    for e in events:\n        t = e.get('type') or 'unknown'\n        counts[t] = counts.get(t, 0) + 1\n    return counts\n",
  "tests": "assert count_events([{'type': 'click'}, {'type': 'view'}, {'type': 'click'}]) == {'click': 2, 'view': 1}\nassert count_events([{'type': 'login'}]) == {'login': 1}\n",
  "hidden": "assert count_events([]) == {}\nassert count_events([{}, {'type': None}]) == {'unknown': 2}\nassert count_events([{'type': 'a'}] * 1000) == {'a': 1000}\nassert count_events([{'type': 'x', 'user': 1}, {'user': 2}]) == {'x': 1, 'unknown': 1}\n",
  "explanation": "One pass over the events increments a counter per type. get with a fallback maps missing or None types to 'unknown'."
}
```
