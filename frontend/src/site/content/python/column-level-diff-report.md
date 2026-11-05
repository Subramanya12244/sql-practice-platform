---
id: PY-119
title: Column Level Reconciliation Report
slug: column-level-diff-report
difficulty: Hard
category: etl
skill: validation
description: Compare source and target tables row by row and column by column with per-column numeric tolerances and null handling.
topic: python-collections
concepts: keyed comparison, per-column tolerance, null equivalence, set operations
time: O((S + T) * C)
space: O(S + T)
minutes: 35
---

## Scenario

After migrating the orders table to a new warehouse, the team must prove the copy is correct before switching dashboards. Row counts match, but the auditors want to know exactly which cells differ.

## Problem

Write `diff_tables(source, target, key, tolerances=None, ignore=())`. Both inputs are lists of dicts. Raise ValueError if a key value repeats within one side. Compared columns are the union of columns from both sides, minus the key and `ignore`; a missing column counts as None. None and '' are equal. Two numbers (int or float, not bool) are equal if they differ by at most `tolerances.get(col, 0)`. Return `{'missing_in_target': [...], 'extra_in_target': [...], 'mismatches': [(key, col, source_value, target_value), ...], 'matched': n}` where matched counts common keys with no mismatching column; all lists sorted.

## Objective

Produce an audit-grade, cell-level reconciliation report.

## Input format

Two lists of dicts, a key column, optional tolerances and ignored columns.

## Output format

A dict of sorted lists and a count.

## Constraints

- Duplicate keys raise ValueError
- bool is not numeric
- Keys of one type per call

## Examples

```
diff_tables([{'id': 1, 'amt': 10.0}], [{'id': 1, 'amt': 10.004}], 'id', {'amt': 0.01})
->  {'missing_in_target': [], 'extra_in_target': [], 'mismatches': [], 'matched': 1}
```

## Hints

- Index each side by key with a dict and check its length against the list length.
- Write one helper same(col, a, b) that handles None/'' and numeric tolerance.
- Use set differences for missing and extra keys.

## Why it matters

Migrations and dual-running pipelines are signed off with exactly this kind of report. Handling tolerances and null semantics explicitly avoids both false alarms and missed differences.

```task
{
  "id": "column-level-diff-report",
  "title": "Column Level Reconciliation Report",
  "type": "python",
  "instructions": "Write `diff_tables(source, target, key, tolerances=None, ignore=())`. Both inputs are lists of dicts. Raise ValueError if a key value repeats within one side. Compared columns are the union of columns from both sides, minus the key and `ignore`; a missing column counts as None. None and '' are equal. Two numbers (int or float, not bool) are equal if they differ by at most `tolerances.get(col, 0)`. Return `{'missing_in_target': [...], 'extra_in_target': [...], 'mismatches': [(key, col, source_value, target_value), ...], 'matched': n}` where matched counts common keys with no mismatching column; all lists sorted.",
  "starter": "def diff_tables(source, target, key, tolerances=None, ignore=()) -> dict:\n    raise NotImplementedError\n",
  "solution": "def _index(rows, key):\n    idx = {}\n    for r in rows:\n        if r[key] in idx:\n            raise ValueError(f\"duplicate key {r[key]}\")\n        idx[r[key]] = r\n    return idx\n\n\ndef _num(v):\n    return isinstance(v, (int, float)) and not isinstance(v, bool)\n\n\ndef diff_tables(source, target, key, tolerances=None, ignore=()) -> dict:\n    tol = tolerances or {}\n    s, t = _index(source, key), _index(target, key)\n    cols = sorted({c for r in source + target for c in r} - {key} - set(ignore))\n\n    def same(col, a, b):\n        a = None if a == \"\" else a\n        b = None if b == \"\" else b\n        if _num(a) and _num(b):\n            return abs(a - b) <= tol.get(col, 0) + 1e-9\n        return a == b\n\n    mismatches, matched = [], 0\n    for k in sorted(s.keys() & t.keys()):\n        bad = [(k, c, s[k].get(c), t[k].get(c)) for c in cols if not same(c, s[k].get(c), t[k].get(c))]\n        mismatches.extend(bad)\n        matched += not bad\n    return {\"missing_in_target\": sorted(s.keys() - t.keys()), \"extra_in_target\": sorted(t.keys() - s.keys()),\n            \"mismatches\": mismatches, \"matched\": matched}\n",
  "tests": "assert diff_tables([{'id': 1, 'amt': 10.0}], [{'id': 1, 'amt': 10.004}], 'id', {'amt': 0.01}) == {'missing_in_target': [], 'extra_in_target': [], 'mismatches': [], 'matched': 1}\nassert diff_tables([], [], 'id') == {'missing_in_target': [], 'extra_in_target': [], 'mismatches': [], 'matched': 0}\n",
  "hidden": "src = [{'id': 1, 'amt': 10, 'status': 'paid', 'note': None, 'etl_ts': 'a'},\n       {'id': 2, 'amt': 5.5, 'status': 'new'},\n       {'id': 3, 'amt': 1, 'status': 'x'}]\ntgt = [{'id': 2, 'amt': 5.6, 'status': 'new', 'etl_ts': 'b'},\n       {'id': 1, 'amt': 10.0, 'status': 'PAID', 'note': '', 'etl_ts': 'c'},\n       {'id': 4, 'amt': 0}]\nr = diff_tables(src, tgt, 'id', {'amt': 0.05}, ignore=('etl_ts',))\nassert r['missing_in_target'] == [3] and r['extra_in_target'] == [4]\nassert r['mismatches'] == [(1, 'status', 'paid', 'PAID'), (2, 'amt', 5.5, 5.6)]\nassert r['matched'] == 0\nr = diff_tables(src, tgt, 'id', {'amt': 0.2}, ignore=('etl_ts', 'status'))\nassert r['matched'] == 2 and r['mismatches'] == []\nassert diff_tables([{'id': 1, 'f': True}], [{'id': 1, 'f': 1}], 'id', {'f': 5})['mismatches'] == []\nassert diff_tables([{'id': 1, 'f': True}], [{'id': 1, 'f': 2}], 'id', {'f': 5})['mismatches'] == [(1, 'f', True, 2)]\nassert diff_tables([{'id': 1, 'extra': 'v'}], [{'id': 1}], 'id')['mismatches'] == [(1, 'extra', 'v', None)]\ntry:\n    diff_tables([{'id': 1}, {'id': 1}], [], 'id')\n    raise AssertionError('expected ValueError')\nexcept ValueError:\n    pass\nbig_s = [{'id': i, 'v': i * 1.0} for i in range(5000)]\nbig_t = [{'id': i, 'v': i * 1.0 + (0.5 if i % 1000 == 0 else 0)} for i in range(5000)]\nassert len(diff_tables(big_s, big_t, 'id', {'v': 0.1})['mismatches']) == 5\n",
  "explanation": "Indexing both sides by key turns the comparison into dictionary lookups and makes duplicate keys, which would make any diff ambiguous, easy to reject. Set differences give rows missing on either side. For common keys every compared column is checked with one helper that maps '' to None and applies a per-column tolerance only when both values are real numbers, excluding bool. Columns that exist on only one side are compared as None, so schema drift shows up as mismatches rather than being ignored. Sorting all outputs makes the report stable and diffable between runs."
}
```
