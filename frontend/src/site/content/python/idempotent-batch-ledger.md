---
id: PY-130
title: Idempotent Batch Loads With A Content Ledger
slug: idempotent-batch-ledger
difficulty: Hard
category: etl
skill: deduplication
description: Track loaded batches by id and content hash so re-runs are no-ops, conflicting re-runs fail, and explicit replaces swap data.
topic: python-oop
concepts: content hashing, idempotency, batch replace, custom exceptions
time: O(r log r) per batch
space: O(total rows)
minutes: 30
---

## Scenario

The daily inventory snapshot loader is sometimes re-triggered by the scheduler, and sometimes a supplier resends a corrected file under the same batch id. Duplicated stock counts in the warehouse have already caused wrong reorder decisions.

## Problem

Define `ConflictError(Exception)` and class `BatchLoader` with `load(batch_id, rows, replace=False)`. Compute a content hash that does not depend on row order or key order inside rows. A new batch_id: append its rows, return 'loaded'. A known batch_id with the same hash: change nothing, return 'skipped'. A known batch_id with a different hash: raise ConflictError unless `replace=True`, in which case remove that batch's rows, append the new rows and return 'replaced'. `rows()` returns all loaded rows (copies, without any internal tags) in load order and `batches()` returns the sorted batch ids.

## Objective

Design a loader whose re-runs are safe and whose conflicting re-runs are loud.

## Input format

Batch ids and lists of row dicts.

## Output format

Status strings, rows and batch ids.

## Constraints

- Hash independent of row and key order
- Rows of other batches untouched by replace
- Use hashlib and json

## Examples

```
b = BatchLoader(); b.load('2024-06-01', [{'sku': 'A', 'qty': 3}])  ->  'loaded'
b.load('2024-06-01', [{'qty': 3, 'sku': 'A'}])  ->  'skipped'
```

## Hints

- Serialise each row with json.dumps(sort_keys=True), sort those strings, then hash the joined result.
- Store rows as (batch_id, row) pairs so a replace can filter by batch.
- Return copies from rows() so callers cannot mutate the loaded data.

## Why it matters

Idempotent loads are what let you retry and backfill without fear of double counting. A content ledger also distinguishes a harmless re-run from a real correction that must be handled deliberately.

```task
{
  "id": "idempotent-batch-ledger",
  "title": "Idempotent Batch Loads With A Content Ledger",
  "type": "python",
  "instructions": "Define `ConflictError(Exception)` and class `BatchLoader` with `load(batch_id, rows, replace=False)`. Compute a content hash that does not depend on row order or key order inside rows. A new batch_id: append its rows, return 'loaded'. A known batch_id with the same hash: change nothing, return 'skipped'. A known batch_id with a different hash: raise ConflictError unless `replace=True`, in which case remove that batch's rows, append the new rows and return 'replaced'. `rows()` returns all loaded rows (copies, without any internal tags) in load order and `batches()` returns the sorted batch ids.",
  "starter": "class ConflictError(Exception):\n    pass\n\n\nclass BatchLoader:\n    def __init__(self):\n        raise NotImplementedError\n",
  "solution": "import hashlib\nimport json\n\n\nclass ConflictError(Exception):\n    pass\n\n\ndef _digest(rows):\n    parts = sorted(json.dumps(r, sort_keys=True) for r in rows)\n    return hashlib.sha256(\"\\n\".join(parts).encode()).hexdigest()\n\n\nclass BatchLoader:\n    def __init__(self):\n        self._ledger = {}\n        self._rows = []\n\n    def load(self, batch_id, rows, replace=False):\n        h = _digest(rows)\n        old = self._ledger.get(batch_id)\n        if old == h:\n            return \"skipped\"\n        if old is not None and not replace:\n            raise ConflictError(f\"batch {batch_id} already loaded with different content\")\n        status = \"loaded\" if old is None else \"replaced\"\n        if old is not None:\n            self._rows = [(b, r) for b, r in self._rows if b != batch_id]\n        self._rows.extend((batch_id, dict(r)) for r in rows)\n        self._ledger[batch_id] = h\n        return status\n\n    def rows(self):\n        return [dict(r) for _, r in self._rows]\n\n    def batches(self):\n        return sorted(self._ledger)\n",
  "tests": "b = BatchLoader()\nassert b.load('2024-06-01', [{'sku': 'A', 'qty': 3}]) == 'loaded'\nassert b.load('2024-06-01', [{'qty': 3, 'sku': 'A'}]) == 'skipped'\nassert b.rows() == [{'sku': 'A', 'qty': 3}]\n",
  "hidden": "b = BatchLoader()\nb.load('d1', [{'sku': 'A', 'qty': 1}, {'sku': 'B', 'qty': 2}])\nb.load('d2', [{'sku': 'C', 'qty': 9}])\nassert b.load('d1', [{'sku': 'B', 'qty': 2}, {'sku': 'A', 'qty': 1}]) == 'skipped'\ntry:\n    b.load('d1', [{'sku': 'A', 'qty': 5}])\n    raise AssertionError('expected ConflictError')\nexcept ConflictError:\n    pass\nassert len(b.rows()) == 3\nassert b.load('d1', [{'sku': 'A', 'qty': 5}], replace=True) == 'replaced'\nassert b.rows() == [{'sku': 'C', 'qty': 9}, {'sku': 'A', 'qty': 5}]\nassert b.load('d1', [{'sku': 'A', 'qty': 5}], replace=True) == 'skipped'\nassert b.batches() == ['d1', 'd2']\nb.rows()[0]['qty'] = 0\nassert b.rows()[0]['qty'] == 9\nsrc = [{'sku': 'Z', 'qty': 1}]\nb.load('d3', src); src[0]['qty'] = 100\nassert b.rows()[-1] == {'sku': 'Z', 'qty': 1}\ne = BatchLoader()\nassert e.load('empty', []) == 'loaded' and e.load('empty', []) == 'skipped' and e.rows() == []\n",
  "explanation": "A content hash built from sorted, key-sorted JSON rows identifies what a batch contains regardless of row order or dict key order. Comparing it with the ledger lets the loader tell a harmless re-run (same hash, skip) from a correction (different hash). Corrections raise ConflictError by default, so a changed file never slips in silently, and replace=True gives a deliberate path that removes only that batch's rows. Copying rows on the way in and out protects the loaded data from outside mutation. The result is a loader that can be retried or backfilled any number of times without double counting."
}
```
