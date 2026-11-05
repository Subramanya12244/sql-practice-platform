---
id: PY-146
title: Split JSON Lines With Bounded File Handles
slug: split-jsonl-bounded-handles
difficulty: Hard
category: files
skill: performance
description: Partition a JSON lines file by key into many output files while never holding more than N files open.
topic: python-file-handling
concepts: OrderedDict LRU, file handles, append mode, generators, try/finally
time: O(lines)
space: O(max_open + distinct keys)
minutes: 35
---

## Scenario

Event exports must be split into one file per tenant before upload. There are thousands of tenants but the container allows only a handful of open file descriptors.

## Problem

Write `split_by_key(src, out_dir, key, max_open)`. Read `src` line by line; parse each line as JSON and append the original line to `out_dir/<value of key>.jsonl`. Lines that are not valid JSON, not an object, or lack the key count as `bad` and are skipped. Keep at most `max_open` files open using least-recently-used eviction; reopening an evicted file must append, while the first open of a file in this run must truncate it. Close every file before returning, even on error. Return `{'files': distinct files written, 'reopens': times an evicted file was reopened, 'max_open': peak open handles, 'bad': bad lines}`.

## Objective

Manage a bounded pool of file handles with LRU eviction while streaming.

## Input format

A source path, output directory, key name and max open handles.

## Output format

A stats dict and files on disk.

## Constraints

- max_open >= 1
- Output line order per file equals input order
- Blank lines are ignored, not bad

## Examples

```
src lines: {"t": "a"} / {"t": "b"} / {"t": "a"}
split_by_key('ev.jsonl', 'out', 't', 1)  ->  {'files': 2, 'reopens': 1, 'max_open': 1, 'bad': 0}
```

## Hints

- An OrderedDict of value -> handle; move_to_end on use and popitem(last=False) to evict.
- A set of values seen this run decides between mode 'w' and 'a'.
- Put the loop in try/finally and close every handle still in the OrderedDict.

## Why it matters

Partitioned writes hit file descriptor limits in real systems, and Spark and Hive writers use the same bounded-writer trick. It also builds the habit of guaranteeing cleanup of resources in long-running jobs.

```task
{
  "id": "split-jsonl-bounded-handles",
  "title": "Split JSON Lines With Bounded File Handles",
  "type": "python",
  "instructions": "Write `split_by_key(src, out_dir, key, max_open)`. Read `src` line by line; parse each line as JSON and append the original line to `out_dir/<value of key>.jsonl`. Lines that are not valid JSON, not an object, or lack the key count as `bad` and are skipped. Keep at most `max_open` files open using least-recently-used eviction; reopening an evicted file must append, while the first open of a file in this run must truncate it. Close every file before returning, even on error. Return `{'files': distinct files written, 'reopens': times an evicted file was reopened, 'max_open': peak open handles, 'bad': bad lines}`.",
  "starter": "def split_by_key(src: str, out_dir: str, key: str, max_open: int) -> dict:\n    raise NotImplementedError\n",
  "solution": "import json\nimport os\nfrom collections import OrderedDict\n\n\ndef split_by_key(src: str, out_dir: str, key: str, max_open: int) -> dict:\n    handles, seen = OrderedDict(), set()\n    stats = {\"files\": 0, \"reopens\": 0, \"max_open\": 0, \"bad\": 0}\n    try:\n        with open(src) as f:\n            for line in f:\n                if not line.strip():\n                    continue\n                try:\n                    rec = json.loads(line)\n                    val = rec[key]\n                except (ValueError, KeyError, TypeError):\n                    stats[\"bad\"] += 1\n                    continue\n                h = handles.get(val)\n                if h is None:\n                    if len(handles) >= max_open:\n                        handles.popitem(last=False)[1].close()\n                    mode = \"a\" if val in seen else \"w\"\n                    if val in seen:\n                        stats[\"reopens\"] += 1\n                    else:\n                        seen.add(val)\n                        stats[\"files\"] += 1\n                    h = handles[val] = open(os.path.join(out_dir, f\"{val}.jsonl\"), mode)\n                    stats[\"max_open\"] = max(stats[\"max_open\"], len(handles))\n                else:\n                    handles.move_to_end(val)\n                h.write(line if line.endswith(\"\\n\") else line + \"\\n\")\n    finally:\n        for h in handles.values():\n            h.close()\n    return stats\n",
  "tests": "import os\nos.makedirs('out', exist_ok=True)\nopen('ev.jsonl', 'w').write('{\"t\": \"a\"}\\n{\"t\": \"b\"}\\n{\"t\": \"a\"}\\n')\nassert split_by_key('ev.jsonl', 'out', 't', 1) == {'files': 2, 'reopens': 1, 'max_open': 1, 'bad': 0}\nassert open('out/a.jsonl').read() == '{\"t\": \"a\"}\\n{\"t\": \"a\"}\\n'\n",
  "hidden": "import os, json\nos.makedirs('o2', exist_ok=True)\nopen('o2/x.jsonl', 'w').write('stale\\n')\nopen('e2.jsonl', 'w').write('{\"t\": \"x\", \"n\": 1}\\nnot json\\n[1,2]\\n{\"u\": 1}\\n\\n{\"t\": \"y\"}\\n{\"t\": \"x\", \"n\": 2}')\nassert split_by_key('e2.jsonl', 'o2', 't', 5) == {'files': 2, 'reopens': 0, 'max_open': 2, 'bad': 3}\nassert [json.loads(l)['n'] for l in open('o2/x.jsonl')] == [1, 2]\nos.makedirs('o3', exist_ok=True)\nopen('e3.jsonl', 'w').write(''.join(json.dumps({'tenant': f't{i % 7}', 'i': i}) + '\\n' for i in range(700)))\ns = split_by_key('e3.jsonl', 'o3', 'tenant', 3)\nassert s['files'] == 7 and s['max_open'] == 3 and s['bad'] == 0 and s['reopens'] == 693\nassert [json.loads(l)['i'] for l in open('o3/t3.jsonl')] == list(range(3, 700, 7))\nopen('e4.jsonl', 'w').write('{\"t\": \"a\"}\\n{\"t\": \"a\"}\\n{\"t\": \"b\"}\\n{\"t\": \"a\"}\\n')\nassert split_by_key('e4.jsonl', 'o3', 't', 2)['reopens'] == 0\nopen('e5.jsonl', 'w').write('')\nassert split_by_key('e5.jsonl', 'o3', 't', 2) == {'files': 0, 'reopens': 0, 'max_open': 0, 'bad': 0}\n",
  "explanation": "An OrderedDict acts as an LRU cache of open handles: touching a key moves it to the end and eviction pops from the front. Tracking which keys were already written in this run decides between truncating on first use and appending after an eviction, so stale output from earlier runs is replaced but evicted files keep their lines. Bad lines are counted instead of crashing the split. The try/finally closes every remaining handle even when an exception escapes. Peak open handles never exceed max_open, which is the property that keeps the job under the descriptor limit."
}
```
