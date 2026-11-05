---
id: PY-074
title: Detect New And Changed Rows By Hash
slug: hash-diff-changed-rows
difficulty: Medium
category: etl
skill: incremental
description: Compare a source extract to stored row hashes and emit inserts, updates and deletes.
topic: python-etl-pipelines
concepts: hashlib, row fingerprints, change data capture
time: O(n log n)
space: O(n)
minutes: 15
---

## Scenario

A supplier sends a full product file daily with no updated_at column. The loader must find which rows actually changed to avoid rewriting the whole table.

## Problem

Write diff_rows(rows, prev_hashes, key). Hash each row as sha256 of json.dumps(row, sort_keys=True). Compare with prev_hashes {key_value: hash}. Return {'insert': [rows with new keys], 'update': [rows whose hash differs], 'delete': sorted keys missing from rows, 'hashes': new {key: hash} map}. Keep input order for insert and update.

## Objective

Implement hash-based change detection for full extracts.

## Input format

rows list, dict, key name.

## Output format

dict.

## Constraints

- Key order in a row must not affect its hash

## Examples

```
prev={'A': h({'sku':'A','p':1})}  rows=[{'sku':'A','p':2},{'sku':'B','p':1}]  ->  insert [B], update [A], delete []
```

## Hints

- sort_keys=True makes the JSON canonical.
- Set difference of old keys minus new keys gives deletes.

## Why it matters

When sources lack change timestamps, row hashing is the standard CDC fallback. It shrinks loads to just the changed rows.

```task
{
  "id": "hash-diff-changed-rows",
  "title": "Detect New And Changed Rows By Hash",
  "type": "python",
  "instructions": "Write diff_rows(rows, prev_hashes, key). Hash each row as sha256 of json.dumps(row, sort_keys=True). Compare with prev_hashes {key_value: hash}. Return {'insert': [rows with new keys], 'update': [rows whose hash differs], 'delete': sorted keys missing from rows, 'hashes': new {key: hash} map}. Keep input order for insert and update.",
  "starter": "def diff_rows(rows: list, prev_hashes: dict, key: str) -> dict:\n    raise NotImplementedError\n",
  "solution": "import hashlib, json\n\ndef diff_rows(rows: list, prev_hashes: dict, key: str) -> dict:\n    ins, upd, hashes = [], [], {}\n    for r in rows:\n        h = hashlib.sha256(json.dumps(r, sort_keys=True).encode()).hexdigest()\n        k = r[key]\n        hashes[k] = h\n        if k not in prev_hashes:\n            ins.append(r)\n        elif prev_hashes[k] != h:\n            upd.append(r)\n    return {'insert': ins, 'update': upd, 'delete': sorted(set(prev_hashes) - set(hashes)), 'hashes': hashes}\n",
  "tests": "import hashlib, json\nh=lambda r: hashlib.sha256(json.dumps(r, sort_keys=True).encode()).hexdigest()\nr=diff_rows([{'sku':'A','p':2},{'sku':'B','p':1}], {'A':h({'sku':'A','p':1})}, 'sku')\nassert (r['insert'], r['update'], r['delete']) == ([{'sku':'B','p':1}], [{'sku':'A','p':2}], [])\nassert r['hashes']['B'] == h({'sku':'B','p':1})\n",
  "hidden": "import hashlib, json\nh=lambda r: hashlib.sha256(json.dumps(r, sort_keys=True).encode()).hexdigest()\nassert diff_rows([], {}, 'k') == {'insert':[], 'update':[], 'delete':[], 'hashes':{}}\nr=diff_rows([{'p':1,'sku':'A'}], {'A':h({'sku':'A','p':1}),'C':'x','B':'y'}, 'sku')\nassert r['update'] == [] and r['delete'] == ['B','C']\nrows=[{'id':i,'v':i} for i in range(2000)]\nfirst=diff_rows(rows, {}, 'id')\nassert len(first['insert'])==2000\nrows[5]={'id':5,'v':-1}\nsecond=diff_rows(rows, first['hashes'], 'id')\nassert second['insert']==[] and second['update']==[{'id':5,'v':-1}]\n",
  "explanation": "Serialising with sorted keys gives a canonical string, so dict key order cannot cause false changes. The sha256 of that string is a compact fingerprint stored per key. New keys are inserts, matching keys with different fingerprints are updates, and old keys absent from today's extract are deletes. Returning the new hash map lets the next run compare against today."
}
```
