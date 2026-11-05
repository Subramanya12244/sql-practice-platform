---
id: PY-140
title: Plan Backfill Chunks From Partition Status
slug: backfill-partition-planner
difficulty: Hard
category: etl
skill: orchestration
description: Turn a partition status map into a minimal list of contiguous backfill date ranges with a maximum chunk size.
topic: python-etl-pipelines
concepts: date ranges, run-length grouping, partition status, validation
time: O(days)
space: O(days)
minutes: 25
---

## Scenario

After a two-week upstream outage, the daily sales partitions are a patchwork of succeeded, failed, missing and currently running dates. The on-call engineer needs a backfill plan that reruns only what is needed, in contiguous chunks the cluster can handle.

## Problem

Write `plan_backfill(start, end, partitions, max_chunk)`. `start` and `end` are inclusive ISO dates; `partitions` maps ISO date to 'success', 'failed' or 'running' (absent means missing). Dates that are failed or missing need a backfill; group consecutive needed dates into chunks `(first_date, last_date)` of at most max_chunk days. A success or running date breaks a chunk. Raise ValueError if start > end, max_chunk < 1 or a status is unknown. Return `{'chunks': [...], 'in_progress': [running dates in range], 'already_done': count of success dates in range}`.

## Objective

Compute a minimal, safe rerun plan from partition metadata.

## Input format

Two ISO dates, a status dict and an int.

## Output format

A dict with chunks, in_progress and already_done.

## Constraints

- Dates outside the range are ignored
- Chunks in date order
- Never include running dates

## Examples

```
plan_backfill('2024-01-01', '2024-01-05', {'2024-01-03': 'success'}, 7)
->  {'chunks': [('2024-01-01', '2024-01-02'), ('2024-01-04', '2024-01-05')], 'in_progress': [], 'already_done': 1}
```

## Hints

- Iterate days with date.fromisoformat and timedelta(days=1).
- Keep the current chunk start and length; flush when you hit a non-needed day or the size cap.
- Validate all statuses up front so a typo fails before planning.

## Why it matters

Backfills are routine after outages, and rerunning everything wastes hours while rerunning running partitions creates races. Planning from partition status is the everyday orchestration skill behind tools like Airflow backfill.

```task
{
  "id": "backfill-partition-planner",
  "title": "Plan Backfill Chunks From Partition Status",
  "type": "python",
  "instructions": "Write `plan_backfill(start, end, partitions, max_chunk)`. `start` and `end` are inclusive ISO dates; `partitions` maps ISO date to 'success', 'failed' or 'running' (absent means missing). Dates that are failed or missing need a backfill; group consecutive needed dates into chunks `(first_date, last_date)` of at most max_chunk days. A success or running date breaks a chunk. Raise ValueError if start > end, max_chunk < 1 or a status is unknown. Return `{'chunks': [...], 'in_progress': [running dates in range], 'already_done': count of success dates in range}`.",
  "starter": "def plan_backfill(start: str, end: str, partitions: dict, max_chunk: int) -> dict:\n    raise NotImplementedError\n",
  "solution": "from datetime import date, timedelta\n\n\ndef plan_backfill(start: str, end: str, partitions: dict, max_chunk: int) -> dict:\n    s, e = date.fromisoformat(start), date.fromisoformat(end)\n    if s > e or max_chunk < 1:\n        raise ValueError(\"bad range or chunk size\")\n    bad = set(partitions.values()) - {\"success\", \"failed\", \"running\"}\n    if bad:\n        raise ValueError(f\"unknown status {bad}\")\n    chunks, running, done = [], [], 0\n    cur = []\n    d = s\n    while d <= e:\n        iso = d.isoformat()\n        st = partitions.get(iso)\n        if st in (\"success\", \"running\"):\n            if cur:\n                chunks.append((cur[0], cur[-1]))\n                cur = []\n            if st == \"running\":\n                running.append(iso)\n            else:\n                done += 1\n        else:\n            cur.append(iso)\n            if len(cur) == max_chunk:\n                chunks.append((cur[0], cur[-1]))\n                cur = []\n        d += timedelta(days=1)\n    if cur:\n        chunks.append((cur[0], cur[-1]))\n    return {\"chunks\": chunks, \"in_progress\": running, \"already_done\": done}\n",
  "tests": "assert plan_backfill('2024-01-01', '2024-01-05', {'2024-01-03': 'success'}, 7) == {'chunks': [('2024-01-01', '2024-01-02'), ('2024-01-04', '2024-01-05')], 'in_progress': [], 'already_done': 1}\nassert plan_backfill('2024-01-01', '2024-01-01', {'2024-01-01': 'success'}, 1) == {'chunks': [], 'in_progress': [], 'already_done': 1}\n",
  "hidden": "p = {'2024-02-27': 'failed', '2024-02-29': 'running', '2024-03-02': 'success', '2023-12-31': 'failed'}\nr = plan_backfill('2024-02-26', '2024-03-05', p, 2)\nassert r == {'chunks': [('2024-02-26', '2024-02-27'), ('2024-02-28', '2024-02-28'), ('2024-03-01', '2024-03-01'), ('2024-03-03', '2024-03-04'), ('2024-03-05', '2024-03-05')], 'in_progress': ['2024-02-29'], 'already_done': 1}\nr = plan_backfill('2023-12-30', '2024-01-02', {}, 10)\nassert r['chunks'] == [('2023-12-30', '2024-01-02')]\ntry:\n    plan_backfill('2024-01-02', '2024-01-01', {}, 3)\n    raise AssertionError('expected ValueError')\nexcept ValueError:\n    pass\ntry:\n    plan_backfill('2024-01-01', '2024-01-02', {}, 0)\n    raise AssertionError('expected ValueError')\nexcept ValueError:\n    pass\ntry:\n    plan_backfill('2024-01-01', '2024-01-02', {'2024-01-01': 'sucess'}, 3)\n    raise AssertionError('expected ValueError')\nexcept ValueError:\n    pass\nr = plan_backfill('2024-01-01', '2024-12-31', {}, 30)\nassert len(r['chunks']) == 13 and r['chunks'][-1] == ('2024-12-26', '2024-12-31')\n",
  "explanation": "Walking the range one day at a time with datetime handles month ends and leap years correctly. Failed and missing days accumulate in the current chunk, while a success or running day closes it, so chunks are always contiguous and never touch partitions that are fine or in flight. Flushing when the chunk reaches max_chunk keeps each rerun within the cluster's capacity. Validating statuses up front turns a typo in metadata into an error instead of an accidental rerun. The summary of in-progress and done partitions gives the operator context for the plan."
}
```
