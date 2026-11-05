---
id: PY-008
title: Incremental Load with a Watermark
slug: incremental-load-watermark
difficulty: Hard
category: etl
skill: incremental
description: Load only new source rows since the last high-water mark and advance the watermark safely.
topic: python-etl-pipelines
concepts: watermarks, incremental loads, sorting, state
time: O(n log n)
space: O(n)
minutes: 30
---

## Scenario

A nightly job copies new or changed order rows from an operational database into the warehouse. It stores a watermark of the last loaded updated_at so each run only moves new rows.

## Problem

Write `def incremental_load(source: list, target: list, state: dict, ts: str = "updated_at") -> int`.
- `state["watermark"]` holds the last loaded timestamp (ISO strings, or missing/`None` on the first run).
- Append to `target` every source row with `row[ts]` strictly greater than the watermark, ordered by `ts` ascending
  (stable for ties). Rows with a `None` timestamp are skipped.
- Set `state["watermark"]` to the max loaded `ts`; leave it unchanged if nothing loaded.
- Return the number of rows loaded. A rerun with no new data loads 0 and changes nothing.

## Objective

Append source rows newer than the watermark to the target in timestamp order, advance the watermark, and return the count loaded.

## Input format

Source rows, a target list and a state dict.

## Output format

The number of rows loaded; target and state are updated.

## Constraints

- Rows without a timestamp are ignored
- Only rows newer than the watermark load

## Examples

```
state = {}
incremental_load([{"id": 1, "updated_at": "2024-01-02"}, {"id": 2, "updated_at": "2024-01-01"}], target, state)
  ->  2, target ids [2, 1], state == {"watermark": "2024-01-02"}
```

## Hints

- ISO-8601 strings in the same format compare correctly as plain strings.
- Filter, then `sorted(..., key=lambda r: r[ts])` (sorted is stable).

## Why it matters

Watermark-based incremental loading is how most production pipelines avoid full reloads, and getting the boundary right prevents both duplicates and gaps.

```task
{
  "id": "incremental-load-watermark",
  "title": "Incremental Load with a Watermark",
  "type": "python",
  "instructions": "Write `def incremental_load(source: list, target: list, state: dict, ts: str = \"updated_at\") -> int`.\n- `state[\"watermark\"]` holds the last loaded timestamp (ISO strings, or missing/`None` on the first run).\n- Append to `target` every source row with `row[ts]` strictly greater than the watermark, ordered by `ts` ascending\n  (stable for ties). Rows with a `None` timestamp are skipped.\n- Set `state[\"watermark\"]` to the max loaded `ts`; leave it unchanged if nothing loaded.\n- Return the number of rows loaded. A rerun with no new data loads 0 and changes nothing.",
  "starter": "def incremental_load(source: list, target: list, state: dict, ts: str = \"updated_at\") -> int:\n    raise NotImplementedError\n",
  "solution": "def incremental_load(source: list, target: list, state: dict, ts: str = \"updated_at\") -> int:\n    wm = state.get(\"watermark\")\n    new = [r for r in source if r.get(ts) is not None and (wm is None or r[ts] > wm)]\n    new.sort(key=lambda r: r[ts])\n    target.extend(new)\n    if new:\n        state[\"watermark\"] = new[-1][ts]\n    return len(new)\n",
  "tests": "src = [{\"id\": 1, \"updated_at\": \"2024-01-02\"}, {\"id\": 2, \"updated_at\": \"2024-01-01\"}, {\"id\": 3, \"updated_at\": None}]\ntgt, st = [], {}\nassert incremental_load(src, tgt, st) == 2\nassert [r[\"id\"] for r in tgt] == [2, 1]\nassert st == {\"watermark\": \"2024-01-02\"}\nassert incremental_load(src, tgt, st) == 0\nassert len(tgt) == 2 and st == {\"watermark\": \"2024-01-02\"}\n",
  "hidden": "src += [{\"id\": 4, \"updated_at\": \"2024-01-03\"}, {\"id\": 5, \"updated_at\": \"2024-01-03\"}, {\"id\": 6, \"updated_at\": \"2024-01-02\"}]\nassert incremental_load(src, tgt, st) == 2\nassert [r[\"id\"] for r in tgt] == [2, 1, 4, 5]\nassert st[\"watermark\"] == \"2024-01-03\"\ne = {\"watermark\": None}\nassert incremental_load([], [], e) == 0 and e == {\"watermark\": None}\n",
  "explanation": "The watermark remembers the newest timestamp already loaded. Each run takes only strictly newer rows, loads them in timestamp order and advances the watermark to the last one, so re-running loads nothing twice."
}
```
