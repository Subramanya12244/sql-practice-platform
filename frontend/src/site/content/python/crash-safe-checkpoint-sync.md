---
id: PY-122
title: Crash Safe Incremental Sync With Checkpoints
slug: crash-safe-checkpoint-sync
difficulty: Hard
category: etl
skill: incremental
description: Load changed rows in batches and persist a composite (updated_at, id) cursor after each batch so a crashed run resumes exactly.
topic: python-etl-pipelines
concepts: composite cursor, checkpoint file, atomic replace, resume after crash
time: O(n log n)
space: O(n)
minutes: 40
---

## Scenario

The customer sync copies changed rows from the CRM into the warehouse in batches. Last week the job died halfway, the next run started from scratch and hammered the CRM API for hours.

## Problem

Write `sync(rows, write, ckpt_path, batch_size)`. `rows` are dicts with `id` and `updated_at` (ISO strings, comparable as text). Read the checkpoint from `ckpt_path` if it exists: a JSON object `{"updated_at": ..., "id": ...}`. Select rows whose `(updated_at, id)` is strictly greater than the checkpoint cursor, sort them by that pair and call `write(batch)` for consecutive batches of `batch_size`. Only after `write` returns, save the cursor of the batch's last row to the checkpoint, atomically (write a temp file then os.replace). If `write` raises, let the exception propagate; the checkpoint must still reflect the last successful batch. Return the number of rows written in this run.

## Objective

Make an incremental loader that can crash at any batch and resume without gaps or redundant work.

## Input format

A list of row dicts, a write callable, a checkpoint path and a batch size.

## Output format

An int and an updated checkpoint file.

## Constraints

- Ties on updated_at broken by id
- Checkpoint written only after a successful write
- No temp files left behind

## Examples

```
rows = [{'id': 1, 'updated_at': '2024-01-01'}, {'id': 2, 'updated_at': '2024-01-02'}]
sync(rows, target_upsert, 'ck.json', 1)  ->  2
sync(rows, target_upsert, 'ck.json', 1)  ->  0
```

## Hints

- Cursor tuple: (r['updated_at'], r['id']); compare tuples directly.
- Write json to ckpt_path + '.tmp' and os.replace it into place.
- Do not catch exceptions from write; the try/except belongs to the caller.

## Why it matters

Checkpointing with a composite cursor is how production incremental jobs avoid both missed rows (ties on updated_at) and full reloads after failures. Writing the checkpoint atomically and only after the commit is the detail that makes resume correct.

```task
{
  "id": "crash-safe-checkpoint-sync",
  "title": "Crash Safe Incremental Sync With Checkpoints",
  "type": "python",
  "instructions": "Write `sync(rows, write, ckpt_path, batch_size)`. `rows` are dicts with `id` and `updated_at` (ISO strings, comparable as text). Read the checkpoint from `ckpt_path` if it exists: a JSON object `{\"updated_at\": ..., \"id\": ...}`. Select rows whose `(updated_at, id)` is strictly greater than the checkpoint cursor, sort them by that pair and call `write(batch)` for consecutive batches of `batch_size`. Only after `write` returns, save the cursor of the batch's last row to the checkpoint, atomically (write a temp file then os.replace). If `write` raises, let the exception propagate; the checkpoint must still reflect the last successful batch. Return the number of rows written in this run.",
  "starter": "def sync(rows, write, ckpt_path: str, batch_size: int) -> int:\n    raise NotImplementedError\n",
  "solution": "import json\nimport os\n\n\ndef sync(rows, write, ckpt_path: str, batch_size: int) -> int:\n    cursor = None\n    if os.path.exists(ckpt_path):\n        with open(ckpt_path) as f:\n            c = json.load(f)\n        cursor = (c[\"updated_at\"], c[\"id\"])\n    pending = sorted((r for r in rows if cursor is None or (r[\"updated_at\"], r[\"id\"]) > cursor),\n                     key=lambda r: (r[\"updated_at\"], r[\"id\"]))\n    done = 0\n    for i in range(0, len(pending), batch_size):\n        batch = pending[i:i + batch_size]\n        write(batch)\n        last = batch[-1]\n        tmp = ckpt_path + \".tmp\"\n        with open(tmp, \"w\") as f:\n            json.dump({\"updated_at\": last[\"updated_at\"], \"id\": last[\"id\"]}, f)\n        os.replace(tmp, ckpt_path)\n        done += len(batch)\n    return done\n",
  "tests": "target = {}\ndef upsert(batch):\n    for r in batch:\n        target[r['id']] = r\nrows = [{'id': 1, 'updated_at': '2024-01-01'}, {'id': 2, 'updated_at': '2024-01-02'}]\nassert sync(rows, upsert, 'ck.json', 1) == 2\nassert sync(rows, upsert, 'ck.json', 1) == 0\nassert sorted(target) == [1, 2]\n",
  "hidden": "import json, os\ntarget, calls = {}, []\nstate = {'crash_at': 2}\ndef flaky(batch):\n    calls.append([r['id'] for r in batch])\n    if len(calls) == state['crash_at']:\n        raise IOError('warehouse down')\n    for r in batch:\n        target[r['id']] = r\nrows = [{'id': i, 'updated_at': '2024-05-0%d' % (1 + i // 2)} for i in range(5)][::-1]\ntry:\n    sync(rows, flaky, 'c2.json', 2)\n    raise AssertionError('expected IOError')\nexcept IOError:\n    pass\nassert json.load(open('c2.json')) == {'updated_at': '2024-05-01', 'id': 1}\nstate['crash_at'] = -1\nassert sync(rows, flaky, 'c2.json', 2) == 3\nassert calls == [[0, 1], [2, 3], [2, 3], [4]] and sorted(target) == [0, 1, 2, 3, 4]\nrows.append({'id': 9, 'updated_at': '2024-05-03'})\nrows.append({'id': 0, 'updated_at': '2024-05-02'})\nassert sync(rows, flaky, 'c2.json', 10) == 1 and target[9]['updated_at'] == '2024-05-03'\nassert not os.path.exists('c2.json.tmp')\nassert sync([], flaky, 'new.json', 3) == 0 and not os.path.exists('new.json')\n",
  "explanation": "A plain updated_at watermark misses rows that share a timestamp with the last loaded row, so the cursor is the pair (updated_at, id) and comparison is strictly greater. The checkpoint is saved only after write succeeds, so a crash leaves it pointing at the last committed batch and the next run restarts exactly at the failed batch. Writing to a temp file and using os.replace means a crash during the checkpoint write cannot corrupt it. Because the target write is an upsert, replaying the failed batch is harmless. Returning the count of rows written makes runs easy to monitor."
}
```
