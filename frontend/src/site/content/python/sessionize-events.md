---
id: PY-145
title: Sessionise Click Events
slug: sessionize-events
difficulty: Hard
category: processing
skill: aggregation
description: Group events into user sessions split by 30 minutes of inactivity.
topic: python-etl-pipelines
concepts: sorting, grouping, inactivity gaps
time: O(n log n)
space: O(n)
minutes: 25
---

## Scenario

A web analytics pipeline receives click events (user, timestamp, page) out of order. Product analysts want sessions per user, where a new session starts after a period of inactivity.

## Problem

Each event is (user, iso_timestamp, page). Events may be unsorted. A user's new session starts when more than gap_minutes pass since their previous event. Return dicts {'user', 'start', 'end', 'events'} (start/end as ISO strings, events = page count), sorted by user then start.

## Objective

Group each user's events into sessions split by gaps longer than gap_minutes, returning start, end and event count sorted by user then start.

## Input format

A list of tuples.

## Output format

A list of dicts.

## Constraints

- Exactly gap_minutes apart is the same session

## Examples

```
sessionize([('u1', '2024-01-01T10:00:00', 'a'), ('u1', '2024-01-01T10:10:00', 'b'), ('u1', '2024-01-01T11:00:00', 'c')])  ->  2 sessions
```

## Hints

- Parse timestamps, sort by (user, time).
- Compare each event with the previous event of the same user.

## Why it matters

Sessionization is a classic clickstream transformation, and it teaches the sort-then-sweep pattern used in gaps-and-islands problems.

```task
{
  "id": "sessionize-events",
  "title": "Sessionise Click Events",
  "type": "python",
  "instructions": "Each event is (user, iso_timestamp, page). Events may be unsorted. A user's new session starts when more than gap_minutes pass since their previous event. Return dicts {'user', 'start', 'end', 'events'} (start/end as ISO strings, events = page count), sorted by user then start.",
  "starter": "def sessionize(events: list, gap_minutes: int = 30) -> list:\n    raise NotImplementedError\n",
  "solution": "from datetime import datetime, timedelta\n\n\ndef sessionize(events: list, gap_minutes: int = 30) -> list:\n    gap = timedelta(minutes=gap_minutes)\n    rows = sorted((u, datetime.fromisoformat(ts), p) for u, ts, p in events)\n    out = []\n    for user, ts, _ in rows:\n        cur = out[-1] if out else None\n        if cur and cur['user'] == user and ts - cur['_end'] <= gap:\n            cur['_end'] = ts\n            cur['events'] += 1\n        else:\n            out.append({'user': user, '_start': ts, '_end': ts, 'events': 1})\n    return [{'user': s['user'], 'start': s['_start'].isoformat(), 'end': s['_end'].isoformat(), 'events': s['events']} for s in out]\n",
  "tests": "r = sessionize([('u1', '2024-01-01T10:00:00', 'a'), ('u1', '2024-01-01T10:10:00', 'b'), ('u1', '2024-01-01T11:00:00', 'c')])\nassert [(s['start'], s['events']) for s in r] == [('2024-01-01T10:00:00', 2), ('2024-01-01T11:00:00', 1)]\n",
  "hidden": "ev = [('b', '2024-01-01T09:00:00', 'x'), ('a', '2024-01-01T10:30:00', 'y'), ('a', '2024-01-01T10:00:00', 'z'), ('b', '2024-01-01T09:30:00', 'w')]\nr = sessionize(ev)\nassert [(s['user'], s['start'], s['end'], s['events']) for s in r] == [('a', '2024-01-01T10:00:00', '2024-01-01T10:30:00', 2), ('b', '2024-01-01T09:00:00', '2024-01-01T09:30:00', 2)]\nassert sessionize([]) == []\nassert len(sessionize([('u', '2024-01-01T00:00:00', 'p'), ('u', '2024-01-01T00:30:01', 'p')])) == 2\nassert len(sessionize([('u', '2024-01-01T00:00:00', 'p'), ('u', '2024-01-01T00:05:00', 'p')], gap_minutes=4)) == 2\n",
  "explanation": "Sorting by (user, time) puts each user's events in order, so a session only needs to compare against the previous event: the same gaps-and-islands idea as LAG in SQL. A gap of exactly the threshold stays in the session, as specified."
}
```
