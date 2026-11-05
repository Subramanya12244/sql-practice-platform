---
id: PY-127
title: External Sort With Spilled Runs
slug: external-sort-spill-runs
difficulty: Hard
category: dsa
skill: performance
description: Sort a dataset larger than memory by spilling sorted runs to disk and merging them lazily.
topic: python-file-handling
concepts: external merge sort, heapq.merge, JSON lines, generators, cleanup
time: O(n log n)
space: O(chunk_size + number of runs)
minutes: 40
---

## Scenario

A partner sends a transaction export that does not fit in the memory of the small container that loads it. The loader must output the transactions sorted by timestamp before they are partitioned.

## Problem

Write a generator `external_sort(records, key, chunk_size, spill_dir, stats=None)`. Read `records` (any iterable of JSON-serialisable dicts) in chunks of at most `chunk_size`, sort each chunk by `key` (a field name) and write it to `spill_dir/run_<i>.jsonl`. Then yield records in globally sorted order by merging the run files lazily, reading them line by line. The sort must be stable (equal keys keep input order). Delete all run files once the merge finishes or the consumer closes the generator. If `stats` is a dict, set `stats['runs']` to the number of run files and `stats['max_chunk']` to the largest chunk held in memory.

## Objective

Implement the two phases of an external merge sort with proper file cleanup.

## Input format

An iterable of dicts, a key name, chunk size, a directory path and an optional stats dict.

## Output format

A generator of dicts in sorted order.

## Constraints

- chunk_size >= 1
- Run files must be removed afterwards
- Stable for equal keys

## Examples

```
list(external_sort([{'ts': 3}, {'ts': 1}, {'ts': 2}], 'ts', 2, '.'))  ->  [{'ts': 1}, {'ts': 2}, {'ts': 3}]
```

## Hints

- Phase 1: buffer up to chunk_size records, sort, dump one JSON per line, clear the buffer.
- Phase 2: open every run as a generator of json.loads(line) and feed them to heapq.merge(..., key=...). heapq.merge is stable across its inputs in order.
- Wrap the merge in try/finally so files are closed and deleted even if the consumer stops early.

## Why it matters

Spark, databases and Unix sort all fall back to external merge sort when data exceeds memory. Implementing it once makes spill files, run counts and merge fan-in concrete when you tune real jobs.

```task
{
  "id": "external-sort-spill-runs",
  "title": "External Sort With Spilled Runs",
  "type": "python",
  "instructions": "Write a generator `external_sort(records, key, chunk_size, spill_dir, stats=None)`. Read `records` (any iterable of JSON-serialisable dicts) in chunks of at most `chunk_size`, sort each chunk by `key` (a field name) and write it to `spill_dir/run_<i>.jsonl`. Then yield records in globally sorted order by merging the run files lazily, reading them line by line. The sort must be stable (equal keys keep input order). Delete all run files once the merge finishes or the consumer closes the generator. If `stats` is a dict, set `stats['runs']` to the number of run files and `stats['max_chunk']` to the largest chunk held in memory.",
  "starter": "def external_sort(records, key: str, chunk_size: int, spill_dir: str, stats=None):\n    raise NotImplementedError\n",
  "solution": "import heapq\nimport json\nimport os\n\n\ndef external_sort(records, key: str, chunk_size: int, spill_dir: str, stats=None):\n    paths, buf, biggest = [], [], 0\n\n    def spill():\n        path = os.path.join(spill_dir, f\"run_{len(paths)}.jsonl\")\n        buf.sort(key=lambda r: r[key])\n        with open(path, \"w\") as f:\n            for r in buf:\n                f.write(json.dumps(r) + \"\\n\")\n        paths.append(path)\n        buf.clear()\n\n    for rec in records:\n        buf.append(rec)\n        biggest = max(biggest, len(buf))\n        if len(buf) >= chunk_size:\n            spill()\n    if buf:\n        spill()\n    if stats is not None:\n        stats[\"runs\"] = len(paths)\n        stats[\"max_chunk\"] = biggest\n    files = [open(p) for p in paths]\n    try:\n        streams = [(json.loads(line) for line in f) for f in files]\n        yield from heapq.merge(*streams, key=lambda r: r[key])\n    finally:\n        for f in files:\n            f.close()\n        for p in paths:\n            os.remove(p)\n",
  "tests": "import os\nassert list(external_sort([{'ts': 3}, {'ts': 1}, {'ts': 2}], 'ts', 2, '.')) == [{'ts': 1}, {'ts': 2}, {'ts': 3}]\nassert not [f for f in os.listdir('.') if f.startswith('run_')]\nassert list(external_sort([], 'ts', 5, '.')) == []\n",
  "hidden": "import os, random\nos.makedirs('spill', exist_ok=True)\nrng = random.Random(7)\ndata = [{'id': i, 'ts': rng.randint(0, 50)} for i in range(1000)]\nst = {}\nout = list(external_sort(iter(data), 'ts', 64, 'spill', st))\nassert out == sorted(data, key=lambda r: r['ts'])\nassert st == {'runs': 16, 'max_chunk': 64}\nassert os.listdir('spill') == []\ng = external_sort(data, 'ts', 100, 'spill')\nassert next(g)['ts'] == 0\ng.close()\nassert os.listdir('spill') == []\nst = {}\nassert [r['id'] for r in external_sort([{'id': 1, 'k': 'b'}, {'id': 2, 'k': 'a'}, {'id': 3, 'k': 'b'}], 'k', 1, 'spill', st)] == [2, 1, 3]\nassert st['runs'] == 3 and st['max_chunk'] == 1\n",
  "explanation": "An external sort first produces sorted runs that each fit in memory and writes them to disk. The second phase is a k-way merge: heapq.merge keeps only the head record of each run in memory and pulls the next line lazily. Because each chunk is sorted stably and heapq.merge prefers earlier inputs on ties, equal keys keep their original order. The try/finally around the merge runs when the generator is exhausted or closed early, so file handles and spill files never leak. Tracking the largest buffer proves memory stayed bounded by chunk_size."
}
```
