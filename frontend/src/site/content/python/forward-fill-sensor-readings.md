---
id: PY-079
title: Forward-Fill Gaps In Device Readings
slug: forward-fill-sensor-readings
difficulty: Medium
category: processing
skill: cleaning
description: Fill missing readings per device with the last known value, up to a maximum gap.
topic: python-collections
concepts: sorting, per-group state, gap limits
time: O(n log n)
space: O(n)
minutes: 15
---

## Scenario

IoT thermostats report every minute but sometimes drop values. Dashboards need filled series, but stale values older than a limit must stay empty.

## Problem

Write ffill(readings, max_gap). readings: dicts {'device','ts' (int),'value' (number or None)} in any order. Sort by (device, ts). For each None value, fill with the device's last non-None value if ts - last_ts <= max_gap, else keep None. Return the sorted list of new dicts, adding 'filled': True/False.

## Objective

Apply stateful per-group cleaning over a sorted series.

## Input format

list of dicts, int max_gap.

## Output format

list of dicts.

## Constraints

- State resets per device
- Do not mutate the input

## Examples

```
ffill([{'device':'d','ts':1,'value':20},{'device':'d','ts':2,'value':None}], 5)
->  [{'device':'d','ts':1,'value':20,'filled':False},{'device':'d','ts':2,'value':20,'filled':True}]
```

## Hints

- Track last value and last timestamp in a dict keyed by device.
- Only real readings update the last timestamp.

## Why it matters

Forward-fill with staleness limits is standard in time series preparation for metrics and ML features. It teaches per-key state across a sorted stream.

```task
{
  "id": "forward-fill-sensor-readings",
  "title": "Forward-Fill Gaps In Device Readings",
  "type": "python",
  "instructions": "Write ffill(readings, max_gap). readings: dicts {'device','ts' (int),'value' (number or None)} in any order. Sort by (device, ts). For each None value, fill with the device's last non-None value if ts - last_ts <= max_gap, else keep None. Return the sorted list of new dicts, adding 'filled': True/False.",
  "starter": "def ffill(readings: list, max_gap: int) -> list:\n    raise NotImplementedError\n",
  "solution": "def ffill(readings: list, max_gap: int) -> list:\n    last = {}\n    out = []\n    for r in sorted(readings, key=lambda r: (r['device'], r['ts'])):\n        r = dict(r)\n        if r['value'] is not None:\n            last[r['device']] = (r['ts'], r['value'])\n            r['filled'] = False\n        else:\n            prev = last.get(r['device'])\n            if prev and r['ts'] - prev[0] <= max_gap:\n                r['value'] = prev[1]\n                r['filled'] = True\n            else:\n                r['filled'] = False\n        out.append(r)\n    return out\n",
  "tests": "assert ffill([{'device':'d','ts':1,'value':20},{'device':'d','ts':2,'value':None}], 5) == [{'device':'d','ts':1,'value':20,'filled':False},{'device':'d','ts':2,'value':20,'filled':True}]\nassert ffill([{'device':'d','ts':10,'value':None},{'device':'d','ts':1,'value':3}], 5)[1] == {'device':'d','ts':10,'value':None,'filled':False}\n",
  "hidden": "assert ffill([], 1) == []\nassert ffill([{'device':'a','ts':1,'value':None}], 9) == [{'device':'a','ts':1,'value':None,'filled':False}]\nr=ffill([{'device':'b','ts':2,'value':None},{'device':'a','ts':1,'value':7}], 5)\nassert r[1]['value'] is None and r[0]['device']=='a'\nsrc=[{'device':'a','ts':1,'value':1},{'device':'a','ts':3,'value':None},{'device':'a','ts':4,'value':None}]\nassert [x['value'] for x in ffill(src, 3)] == [1,1,1]\nassert src[1]['value'] is None\nassert [x['value'] for x in ffill(src, 2)] == [1,1,None]\n",
  "explanation": "Sorting by device then time turns the problem into a single ordered scan. The last real reading per device is stored with its timestamp, and only real readings update it, so the gap is measured from the true last observation. Copying each dict keeps the input unchanged, and the filled flag records lineage for downstream users."
}
```
