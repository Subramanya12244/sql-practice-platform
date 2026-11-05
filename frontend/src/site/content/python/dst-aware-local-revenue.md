---
id: PY-124
title: Daily Revenue In Store Local Time
slug: dst-aware-local-revenue
difficulty: Hard
category: processing
skill: aggregation
description: Bucket UTC order timestamps into each store's local calendar day using offset schedules that change over time.
topic: python-collections
concepts: UTC offsets, effective-dated offsets, bisect, datetime
time: O(n log s)
space: O(stores * days)
minutes: 30
---

## Scenario

Store managers complain that late-evening sales show up on the next day in the revenue dashboard. The orders are stored in UTC, and each store's UTC offset changes during the year because of daylight saving.

## Problem

Write `daily_local_revenue(orders, offsets)`. Each order has `store`, `ts` (ISO UTC like '2024-03-10T23:30:00Z') and `amount`. `offsets` maps store to a list of `(effective_utc, offset_minutes)` in any order; an offset applies from its effective UTC instant (inclusive) until the next one. Convert each order to local time and return a dict `{(store, 'YYYY-MM-DD'): total}` with totals rounded to 2 decimals. Raise ValueError for an order of a store with no offsets or with a timestamp before the store's first effective instant.

## Objective

Apply effective-dated time zone offsets correctly when windowing data by local day.

## Input format

A list of order dicts and a dict of offset schedules.

## Output format

dict[(str, str), float].

## Constraints

- Timestamps end in 'Z'
- Offsets in minutes, may be negative
- Use only the standard library

## Examples

```
offsets = {'NYC': [('2024-01-01T00:00:00Z', -300), ('2024-03-10T07:00:00Z', -240)]}
daily_local_revenue([{'store': 'NYC', 'ts': '2024-03-10T03:30:00Z', 'amount': 10}], offsets)  ->  {('NYC', '2024-03-09'): 10}
```

## Hints

- Parse with datetime.fromisoformat(ts.replace('Z', '+00:00')).
- Sort each store's schedule once; bisect_right on the effective instants finds the active offset.
- local = utc + timedelta(minutes=offset); key on local.date().isoformat().

## Why it matters

Time zone bugs silently shift revenue between days and break daily KPIs. Handling offset changes yourself teaches why you store UTC and convert at the edge with effective-dated rules.

```task
{
  "id": "dst-aware-local-revenue",
  "title": "Daily Revenue In Store Local Time",
  "type": "python",
  "instructions": "Write `daily_local_revenue(orders, offsets)`. Each order has `store`, `ts` (ISO UTC like '2024-03-10T23:30:00Z') and `amount`. `offsets` maps store to a list of `(effective_utc, offset_minutes)` in any order; an offset applies from its effective UTC instant (inclusive) until the next one. Convert each order to local time and return a dict `{(store, 'YYYY-MM-DD'): total}` with totals rounded to 2 decimals. Raise ValueError for an order of a store with no offsets or with a timestamp before the store's first effective instant.",
  "starter": "def daily_local_revenue(orders, offsets: dict) -> dict:\n    raise NotImplementedError\n",
  "solution": "import bisect\nfrom collections import defaultdict\nfrom datetime import datetime, timedelta\n\n\ndef _p(ts):\n    return datetime.fromisoformat(ts.replace(\"Z\", \"+00:00\"))\n\n\ndef daily_local_revenue(orders, offsets: dict) -> dict:\n    sched = {}\n    for store, rows in offsets.items():\n        rows = sorted((_p(t), m) for t, m in rows)\n        sched[store] = ([t for t, _ in rows], [m for _, m in rows])\n    totals = defaultdict(float)\n    for o in orders:\n        if o[\"store\"] not in sched or not sched[o[\"store\"]][0]:\n            raise ValueError(f\"no offsets for {o['store']}\")\n        starts, mins = sched[o[\"store\"]]\n        utc = _p(o[\"ts\"])\n        i = bisect.bisect_right(starts, utc) - 1\n        if i < 0:\n            raise ValueError(\"timestamp before first offset\")\n        local = utc + timedelta(minutes=mins[i])\n        totals[(o[\"store\"], local.date().isoformat())] += o[\"amount\"]\n    return {k: round(v, 2) for k, v in totals.items()}\n",
  "tests": "offsets = {'NYC': [('2024-01-01T00:00:00Z', -300), ('2024-03-10T07:00:00Z', -240)]}\nassert daily_local_revenue([{'store': 'NYC', 'ts': '2024-03-10T03:30:00Z', 'amount': 10}], offsets) == {('NYC', '2024-03-09'): 10}\nassert daily_local_revenue([], offsets) == {}\n",
  "hidden": "offsets = {'NYC': [('2024-03-10T07:00:00Z', -240), ('2024-01-01T00:00:00Z', -300)], 'BLR': [('2000-01-01T00:00:00Z', 330)]}\norders = [\n    {'store': 'NYC', 'ts': '2024-03-11T03:30:00Z', 'amount': 5},\n    {'store': 'NYC', 'ts': '2024-03-11T04:30:00Z', 'amount': 7.25},\n    {'store': 'NYC', 'ts': '2024-03-10T07:00:00Z', 'amount': 1},\n    {'store': 'BLR', 'ts': '2024-03-10T18:30:00Z', 'amount': 3.333},\n    {'store': 'BLR', 'ts': '2024-03-10T18:29:59Z', 'amount': 2},\n]\nassert daily_local_revenue(orders, offsets) == {('NYC', '2024-03-10'): 6, ('NYC', '2024-03-11'): 7.25, ('BLR', '2024-03-11'): 3.33, ('BLR', '2024-03-10'): 2}\ntry:\n    daily_local_revenue([{'store': 'X', 'ts': '2024-01-01T00:00:00Z', 'amount': 1}], {})\n    raise AssertionError('expected ValueError')\nexcept ValueError:\n    pass\ntry:\n    daily_local_revenue([{'store': 'NYC', 'ts': '2023-12-31T23:59:59Z', 'amount': 1}], {'NYC': [('2024-01-01T00:00:00Z', -300)]})\n    raise AssertionError('expected ValueError')\nexcept ValueError:\n    pass\nr = daily_local_revenue([{'store': 'S', 'ts': '2024-01-01T00:00:00Z', 'amount': 0.1}] * 3, {'S': [('2024-01-01T00:00:00Z', 0)]})\nassert r == {('S', '2024-01-01'): 0.3}\n",
  "explanation": "Orders are stored in UTC, but business days are defined in local time, so each timestamp must be shifted by the offset active at that instant. Sorting each store's effective-dated schedule allows bisect to find the active offset in O(log s). The boundary is inclusive, so an order exactly at the switch uses the new offset. Orders before any known offset are rejected rather than guessed, which surfaces reference data gaps. Rounding only at the end avoids accumulating rounding error across many small amounts."
}
```
