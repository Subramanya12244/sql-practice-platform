---
id: PY-110
title: Transform Records And Quarantine Failures
slug: transform-with-quarantine
difficulty: Medium
category: etl
skill: reliability
description: Apply a transform to each record, quarantine failures with the error and abort if the failure rate is too high.
topic: python-etl-pipelines
concepts: per-record try/except, quarantine list, error threshold
time: O(n)
space: O(n)
minutes: 15
---

## Scenario

A product import runs a transform per row. A few bad rows should not stop the import, but if most rows fail the upstream feed is broken and the run must abort.

## Problem

Write run_transform(records, transform, max_fail_ratio). Call transform(record) for each record; collect results. When it raises any Exception, add {'record': record, 'error': 'ExcType: message'} to quarantine. After processing, if records is non-empty and len(quarantine)/len(records) > max_fail_ratio raise RuntimeError. Return (results, quarantine).

## Objective

Isolate per-record failures while enforcing a run-level health threshold.

## Input format

list, callable, float.

## Output format

tuple (list, list).

## Constraints

- Ratio equal to the limit is allowed

## Examples

```
run_transform([{'p':'1'},{'p':'x'}], lambda r: float(r['p']), 0.5)  ->  ([1.0], [{'record':{'p':'x'},'error':"ValueError: could not convert string to float: 'x'"}])
```

## Hints

- type(e).__name__ gives the exception class name.
- Check the ratio once after the loop.

## Why it matters

Quarantine plus a failure threshold is a standard ETL reliability pattern. It keeps good data flowing while catching systemic breakage.

```task
{
  "id": "transform-with-quarantine",
  "title": "Transform Records And Quarantine Failures",
  "type": "python",
  "instructions": "Write run_transform(records, transform, max_fail_ratio). Call transform(record) for each record; collect results. When it raises any Exception, add {'record': record, 'error': 'ExcType: message'} to quarantine. After processing, if records is non-empty and len(quarantine)/len(records) > max_fail_ratio raise RuntimeError. Return (results, quarantine).",
  "starter": "def run_transform(records: list, transform, max_fail_ratio: float) -> tuple:\n    raise NotImplementedError\n",
  "solution": "def run_transform(records: list, transform, max_fail_ratio: float) -> tuple:\n    results, quarantine = [], []\n    for r in records:\n        try:\n            results.append(transform(r))\n        except Exception as e:\n            quarantine.append({'record': r, 'error': f'{type(e).__name__}: {e}'})\n    if records and len(quarantine) / len(records) > max_fail_ratio:\n        raise RuntimeError(f'{len(quarantine)} of {len(records)} records failed')\n    return results, quarantine\n",
  "tests": "assert run_transform([{'p':'1'},{'p':'x'}], lambda r: float(r['p']), 0.5) == ([1.0], [{'record':{'p':'x'},'error':\"ValueError: could not convert string to float: 'x'\"}])\nassert run_transform([{'p':'2'}], lambda r: float(r['p']), 0) == ([2.0], [])\n",
  "hidden": "assert run_transform([], lambda r: 1/0, 0) == ([], [])\ntry:\n    run_transform([{}, {'p':'1'}], lambda r: float(r['p']), 0.4); assert False\nexcept RuntimeError:\n    pass\nr,q=run_transform([{}], lambda r: r['p'], 1.0)\nassert q == [{'record':{}, 'error':\"KeyError: 'p'\"}]\nrecs=[{'p':str(i) if i%10 else 'bad'} for i in range(1000)]\nr,q=run_transform(recs, lambda r: float(r['p']), 0.1)\nassert len(r)==900 and len(q)==100\n",
  "explanation": "Each record gets its own try block, so one failure only affects that row and the original record is kept for replay. Formatting the error with the class name makes quarantine entries easy to group. The ratio check runs after the loop and compares strictly, so hitting the limit exactly is allowed while anything worse aborts the run."
}
```
