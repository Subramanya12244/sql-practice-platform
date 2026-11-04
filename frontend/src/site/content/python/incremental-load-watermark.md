---
title: Incremental Load with a Watermark
slug: incremental-load-watermark
difficulty: Hard
description: Load only new source rows since the last high-water mark and advance the watermark safely.
topic: python-etl-pipelines
minutes: 30
---

## Problem

Write `def incremental_load(source: list, target: list, state: dict, ts: str = "updated_at") -> int`.
- `state["watermark"]` holds the last loaded timestamp (ISO strings, or missing/`None` on the first run).
- Append to `target` every source row with `row[ts]` strictly greater than the watermark, ordered by `ts` ascending
  (stable for ties). Rows with a `None` timestamp are skipped.
- Set `state["watermark"]` to the max loaded `ts`; leave it unchanged if nothing loaded.
- Return the number of rows loaded. A rerun with no new data loads 0 and changes nothing.

## Examples

```
state = {}
incremental_load([{"id": 1, "updated_at": "2024-01-02"}, {"id": 2, "updated_at": "2024-01-01"}], target, state)
  ->  2, target ids [2, 1], state == {"watermark": "2024-01-02"}
```

## Hints

- ISO-8601 strings in the same format compare correctly as plain strings.
- Filter, then `sorted(..., key=lambda r: r[ts])` (sorted is stable).

```task
{
  "id": "incremental-load-watermark",
  "title": "Incremental Load with a Watermark",
  "type": "python",
  "instructions": "Write `def incremental_load(source: list, target: list, state: dict, ts: str = \"updated_at\") -> int`.\n- `state[\"watermark\"]` holds the last loaded timestamp (ISO strings, or missing/`None` on the first run).\n- Append to `target` every source row with `row[ts]` strictly greater than the watermark, ordered by `ts` ascending\n  (stable for ties). Rows with a `None` timestamp are skipped.\n- Set `state[\"watermark\"]` to the max loaded `ts`; leave it unchanged if nothing loaded.\n- Return the number of rows loaded. A rerun with no new data loads 0 and changes nothing.",
  "starter": "def incremental_load(source: list, target: list, state: dict, ts: str = \"updated_at\") -> int:\n    raise NotImplementedError\n",
  "solution": "def incremental_load(source: list, target: list, state: dict, ts: str = \"updated_at\") -> int:\n    wm = state.get(\"watermark\")\n    new = [r for r in source if r.get(ts) is not None and (wm is None or r[ts] > wm)]\n    new.sort(key=lambda r: r[ts])\n    target.extend(new)\n    if new:\n        state[\"watermark\"] = new[-1][ts]\n    return len(new)\n",
  "tests": "src = [{\"id\": 1, \"updated_at\": \"2024-01-02\"}, {\"id\": 2, \"updated_at\": \"2024-01-01\"}, {\"id\": 3, \"updated_at\": None}]\ntgt, st = [], {}\nassert incremental_load(src, tgt, st) == 2\nassert [r[\"id\"] for r in tgt] == [2, 1]\nassert st == {\"watermark\": \"2024-01-02\"}\nassert incremental_load(src, tgt, st) == 0\nassert len(tgt) == 2 and st == {\"watermark\": \"2024-01-02\"}\nsrc += [{\"id\": 4, \"updated_at\": \"2024-01-03\"}, {\"id\": 5, \"updated_at\": \"2024-01-03\"}, {\"id\": 6, \"updated_at\": \"2024-01-02\"}]\nassert incremental_load(src, tgt, st) == 2\nassert [r[\"id\"] for r in tgt] == [2, 1, 4, 5]\nassert st[\"watermark\"] == \"2024-01-03\"\ne = {\"watermark\": None}\nassert incremental_load([], [], e) == 0 and e == {\"watermark\": None}\n"
}
```
