---
id: PY-100
title: Resume A Load From A Checkpoint File
slug: checkpointed-incremental-load
difficulty: Medium
category: etl
skill: incremental
description: Process records in id order, saving a checkpoint so a rerun resumes after the last committed id.
topic: python-etl-pipelines
concepts: checkpoint file, resumable processing, json state
time: O(n log n)
space: O(n)
minutes: 20
---

## Scenario

A nightly job loads order events. If it crashes halfway, the rerun must not reload events that were already committed.

## Problem

Write run_load(records, load, checkpoint_path, every=2). Read the last committed id from checkpoint_path (JSON {'last_id': n}); if the file is missing start from None. Process records with id > last_id in ascending id order, calling load(record). After every `every` successful loads and at the end, write the checkpoint. If load raises, write the checkpoint for what succeeded, then re-raise. Return the number of records loaded in this run.

## Objective

Make a load resumable and idempotent with a persisted checkpoint.

## Input format

records list, load callable, path, int.

## Output format

int.

## Constraints

- Checkpoint lives in the current directory

## Examples

```
first run fails on id 3 -> checkpoint {'last_id': 2}; rerun loads only ids 3 and later
```

## Hints

- Use try/except FileNotFoundError when reading the checkpoint.
- Use try/finally or except to persist progress before re-raising.

## Why it matters

Checkpointing is what turns a fragile batch job into one that can be safely retried. It is the basis of exactly-once style incremental loads.

```task
{
  "id": "checkpointed-incremental-load",
  "title": "Resume A Load From A Checkpoint File",
  "type": "python",
  "instructions": "Write run_load(records, load, checkpoint_path, every=2). Read the last committed id from checkpoint_path (JSON {'last_id': n}); if the file is missing start from None. Process records with id > last_id in ascending id order, calling load(record). After every `every` successful loads and at the end, write the checkpoint. If load raises, write the checkpoint for what succeeded, then re-raise. Return the number of records loaded in this run.",
  "starter": "def run_load(records: list, load, checkpoint_path: str, every: int = 2) -> int:\n    raise NotImplementedError\n",
  "solution": "import json\n\ndef run_load(records: list, load, checkpoint_path: str, every: int = 2) -> int:\n    try:\n        with open(checkpoint_path) as f:\n            last = json.load(f).get('last_id')\n    except FileNotFoundError:\n        last = None\n    def save(v):\n        with open(checkpoint_path, 'w') as f:\n            json.dump({'last_id': v}, f)\n    todo = sorted((r for r in records if last is None or r['id'] > last), key=lambda r: r['id'])\n    n = 0\n    try:\n        for r in todo:\n            load(r)\n            last, n = r['id'], n + 1\n            if n % every == 0:\n                save(last)\n    finally:\n        save(last)\n    return n\n",
  "tests": "import json, os\nif os.path.exists('cp.json'): os.remove('cp.json')\nrecs=[{'id':i} for i in [3,1,2,4]]\ndone=[]\ndef flaky(r):\n    if r['id']==3 and not done.count('x'):\n        done.append('x'); raise IOError('db down')\n    done.append(r['id'])\ntry:\n    run_load(recs, flaky, 'cp.json'); assert False\nexcept IOError:\n    pass\nassert json.load(open('cp.json')) == {'last_id':2}\nassert run_load(recs, flaky, 'cp.json') == 2\nassert done == [1,2,'x',3,4]\n",
  "hidden": "import json, os\nif os.path.exists('k.json'): os.remove('k.json')\nassert run_load([], lambda r: None, 'k.json') == 0\nassert json.load(open('k.json')) == {'last_id':None}\nassert run_load([{'id':5}], lambda r: None, 'k.json') == 1\nassert run_load([{'id':5},{'id':4}], lambda r: None, 'k.json') == 0\nos.remove('k.json')\nseen=[]\nassert run_load([{'id':i} for i in range(2000)], seen.append, 'k.json', every=500) == 2000\nassert json.load(open('k.json')) == {'last_id':1999} and len(seen)==2000\n",
  "explanation": "The checkpoint holds the highest id that was fully loaded, so a rerun filters to ids above it. Sorting by id makes that single watermark valid. Saving every N records bounds rework, and the finally block persists progress even when load raises, after which the exception still propagates. Rerunning with nothing new loads zero records, which makes the job idempotent."
}
```
