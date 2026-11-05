---
id: PY-089
title: Merge Daily JSON Inventory Snapshots
slug: merge-json-snapshots
difficulty: Medium
category: files
skill: ingestion
description: Combine several JSON snapshot files into one current inventory file, newest file wins.
topic: python-file-handling
concepts: json.load, file listing, latest-wins merge
time: O(f log f + n)
space: O(s)
minutes: 15
---

## Scenario

Each store uploads inventory_YYYY-MM-DD.json with a list of {sku, qty}. Head office wants one current stock file, where a newer snapshot overrides older ones.

## Problem

Write merge_snapshots(paths, out_path). Process paths in date order taken from the file name (the YYYY-MM-DD part), not the given order. Each file holds a JSON list of {'sku','qty'}. Later files override qty for a sku. Files that fail to parse are skipped and listed. Write out_path as a JSON object {sku: qty} with sorted keys and return the list of skipped paths (in processing order).

## Objective

Read multiple files with error handling and merge them with a latest-wins rule.

## Input format

list of file paths, output path.

## Output format

list of skipped paths; out_path written.

## Constraints

- Dates are found with a regex in the name

## Examples

```
inventory_2024-01-02.json [{'sku':'A','qty':1}], inventory_2024-01-01.json [{'sku':'A','qty':9},{'sku':'B','qty':2}]  ->  {'A':1,'B':2}
```

## Hints

- Sort paths by re.search(r'\d{4}-\d{2}-\d{2}', p).group().
- Catch ValueError (JSONDecodeError) per file.

## Why it matters

Snapshot consolidation is common when sources deliver full extracts per day. Ordering by business date instead of arrival order prevents stale overwrites.

```task
{
  "id": "merge-json-snapshots",
  "title": "Merge Daily JSON Inventory Snapshots",
  "type": "python",
  "instructions": "Write merge_snapshots(paths, out_path). Process paths in date order taken from the file name (the YYYY-MM-DD part), not the given order. Each file holds a JSON list of {'sku','qty'}. Later files override qty for a sku. Files that fail to parse are skipped and listed. Write out_path as a JSON object {sku: qty} with sorted keys and return the list of skipped paths (in processing order).",
  "starter": "def merge_snapshots(paths: list, out_path: str) -> list:\n    raise NotImplementedError\n",
  "solution": "import json, re\n\ndef merge_snapshots(paths: list, out_path: str) -> list:\n    def day(p):\n        m = re.search(r'\\d{4}-\\d{2}-\\d{2}', p)\n        return m.group() if m else ''\n    stock, skipped = {}, []\n    for p in sorted(paths, key=day):\n        try:\n            with open(p) as f:\n                rows = json.load(f)\n        except ValueError:\n            skipped.append(p)\n            continue\n        for r in rows:\n            stock[r['sku']] = r['qty']\n    with open(out_path, 'w') as f:\n        json.dump(stock, f, sort_keys=True)\n    return skipped\n",
  "tests": "import json\njson.dump([{'sku':'A','qty':1}], open('inventory_2024-01-02.json','w'))\njson.dump([{'sku':'A','qty':9},{'sku':'B','qty':2}], open('inventory_2024-01-01.json','w'))\nassert merge_snapshots(['inventory_2024-01-02.json','inventory_2024-01-01.json'], 'cur.json') == []\nassert json.load(open('cur.json')) == {'A':1,'B':2}\n",
  "hidden": "import json\nassert merge_snapshots([], 'cur.json') == []\nassert json.load(open('cur.json')) == {}\nopen('inventory_2024-02-01.json','w').write('{oops')\njson.dump([{'sku':'Z','qty':0}], open('inventory_2024-01-15.json','w'))\nassert merge_snapshots(['inventory_2024-02-01.json','inventory_2024-01-15.json'], 'cur.json') == ['inventory_2024-02-01.json']\nassert json.load(open('cur.json')) == {'Z':0}\nfor d in range(1,29):\n    json.dump([{'sku':'S','qty':d}], open(f'inventory_2024-03-{d:02d}.json','w'))\nps=[f'inventory_2024-03-{d:02d}.json' for d in range(28,0,-1)]\nmerge_snapshots(ps,'cur.json')\nassert json.load(open('cur.json')) == {'S':28}\n",
  "explanation": "Sorting by the date embedded in the file name means the newest snapshot is applied last, regardless of the order files were listed. A plain dict update gives latest-wins semantics per sku. Parsing errors are caught per file so one corrupt upload does not block the rest, and the skipped list makes the failure visible."
}
```
