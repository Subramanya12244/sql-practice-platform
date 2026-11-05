---
id: PY-063
title: Unique Daily Visitors
slug: unique-daily-visitors
difficulty: Easy
category: dsa
skill: aggregation
description: Count distinct users per day from page view events.
topic: python-collections
concepts: sets, dict of sets
time: O(n)
space: O(n)
minutes: 6
---

## Scenario

Marketing tracks daily active users. A user who visits ten times in a day still counts once.

## Problem

Write `daily_uniques(events)` where each event is a (date, user_id) tuple. Return a dict mapping date to the number of distinct users that day.

## Objective

Count the distinct users seen on each date in a list of page view events.

## Input format

A list of (date_str, user_id) tuples.

## Output format

A dict date -> int.

## Constraints

- Empty input returns {}

## Examples

```
daily_uniques([('d1', 'u1'), ('d1', 'u1'), ('d1', 'u2'), ('d2', 'u1')])  ->  {'d1': 2, 'd2': 1}
```

## Hints

- Keep a set of users per date.
- Convert sets to their lengths at the end.

## Why it matters

Distinct counts are a core metric, and sets are the in-memory way to compute COUNT(DISTINCT). Knowing this helps when checking warehouse numbers.

```task
{
  "id": "unique-daily-visitors",
  "title": "Unique Daily Visitors",
  "type": "python",
  "instructions": "Write `daily_uniques(events)` where each event is a (date, user_id) tuple. Return a dict mapping date to the number of distinct users that day.",
  "starter": "def daily_uniques(events):\n    raise NotImplementedError\n",
  "solution": "def daily_uniques(events):\n    seen = {}\n    for d, u in events:\n        seen.setdefault(d, set()).add(u)\n    return {d: len(s) for d, s in seen.items()}\n",
  "tests": "assert daily_uniques([('d1', 'u1'), ('d1', 'u1'), ('d1', 'u2'), ('d2', 'u1')]) == {'d1': 2, 'd2': 1}\n",
  "hidden": "assert daily_uniques([]) == {}\nassert daily_uniques([('d', i % 10) for i in range(10000)]) == {'d': 10}\nassert daily_uniques([('a', 1), ('b', 1)]) == {'a': 1, 'b': 1}\n",
  "explanation": "A set ignores repeated users automatically. Grouping sets by date and taking their length gives the distinct count per day in one pass."
}
```
