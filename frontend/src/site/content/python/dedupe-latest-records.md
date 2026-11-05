---
id: PY-083
title: Keep The Latest Record Per Key
slug: dedupe-latest-records
difficulty: Medium
category: processing
skill: deduplication
description: Deduplicate change records, keeping the newest per id.
topic: python-etl-pipelines
concepts: dicts, timestamps, deduplication
time: O(n + k log k)
space: O(k)
minutes: 10
---

## Scenario

A CDC feed of customer records sends a new version of a row every time it changes, sometimes out of order. The current-state table needs only the latest version of each customer.

## Problem

Each record is a dict with 'id', 'updated_at' (ISO timestamp string) and other fields. Return one record per id: the one with the latest updated_at (on a tie, the later one in the input). Output sorted by id.

## Objective

Return one record per id, the one with the latest updated_at (the later input on ties), sorted by id.

## Input format

A list of dicts.

## Output format

A list of dicts.

## Constraints

- ISO timestamps compare correctly as strings only if same format; parse them

## Examples

```
latest_per_id([{'id': 1, 'updated_at': '2024-01-01T10:00:00', 'v': 'a'}, {'id': 1, 'updated_at': '2024-01-02T09:00:00', 'v': 'b'}])  ->  [{'id': 1, ..., 'v': 'b'}]
```

## Hints

- `datetime.fromisoformat` parses the timestamps.
- Replace the stored record when the new one is newer or equal.

## Why it matters

Keeping the latest version per key is how you build current-state tables from change logs, the same logic as ROW_NUMBER() OVER (PARTITION BY id ORDER BY updated_at DESC) = 1.

```task
{
  "id": "dedupe-latest-records",
  "title": "Keep The Latest Record Per Key",
  "type": "python",
  "instructions": "Each record is a dict with 'id', 'updated_at' (ISO timestamp string) and other fields. Return one record per id: the one with the latest updated_at (on a tie, the later one in the input). Output sorted by id.",
  "starter": "def latest_per_id(records: list) -> list:\n    raise NotImplementedError\n",
  "solution": "from datetime import datetime\n\n\ndef latest_per_id(records: list) -> list:\n    best = {}\n    for r in records:\n        ts = datetime.fromisoformat(r['updated_at'])\n        cur = best.get(r['id'])\n        if cur is None or ts >= cur[0]:\n            best[r['id']] = (ts, r)\n    return [best[k][1] for k in sorted(best)]\n",
  "tests": "r = latest_per_id([{'id': 1, 'updated_at': '2024-01-01T10:00:00', 'v': 'a'}, {'id': 1, 'updated_at': '2024-01-02T09:00:00', 'v': 'b'}])\nassert [x['v'] for x in r] == ['b']\n",
  "hidden": "recs = [\n    {'id': 2, 'updated_at': '2024-01-01T10:00:00', 'v': 'x'},\n    {'id': 1, 'updated_at': '2024-01-01T10:00:00+00:00', 'v': 'p'},\n    {'id': 1, 'updated_at': '2024-01-01T11:00:00+01:00', 'v': 'q'},\n    {'id': 2, 'updated_at': '2024-01-01T10:00:00', 'v': 'y'},\n]\nassert [(x['id'], x['v']) for x in latest_per_id(recs)] == [(1, 'q'), (2, 'y')]\nassert latest_per_id([]) == []\n",
  "explanation": "Parsing timestamps compares instants, not strings: '11:00+01:00' equals '10:00+00:00'. Using >= keeps the later of two records with the same timestamp, matching the stated tie rule."
}
```
