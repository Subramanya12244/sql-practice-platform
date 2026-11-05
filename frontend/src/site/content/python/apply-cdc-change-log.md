---
id: PY-115
title: Apply An Out Of Order CDC Log
slug: apply-cdc-change-log
difficulty: Hard
category: processing
skill: incremental
description: Merge a Debezium-style change log into a snapshot, handling reordering, replays and partial updates.
topic: python-etl-pipelines
concepts: change data capture, LSN ordering, partial updates, idempotency
time: O(n log n)
space: O(snapshot + n)
minutes: 35
---

## Scenario

A CDC connector streams inserts, updates and deletes from the orders database into the lake. Events can arrive out of order across partitions, and the connector replays some events after a restart.

## Problem

Write `apply_cdc(snapshot, snapshot_lsn, events)`. `snapshot` maps primary key to row dict and reflects all changes up to `snapshot_lsn`. Each event has `lsn` (int), `op` ('c' create, 'u' update, 'd' delete), `key` and `data` (full row for 'c', changed fields only for 'u', None for 'd'). Apply events in lsn order, ignoring events with lsn <= snapshot_lsn and duplicate lsns (keep the first one seen). 'c' on an existing key overwrites it. 'u' merges data into the existing row; 'u' on a missing key is not applied and its lsn goes to an `errors` list. 'd' on a missing key is a no-op. Do not mutate the input snapshot or rows. Return `(new_snapshot, last_lsn, errors)` where last_lsn is the highest lsn applied or seen (or snapshot_lsn if none).

## Objective

Build a correct and replay-safe CDC merge.

## Input format

A snapshot dict, an int lsn and a list of event dicts.

## Output format

(dict, int, list[int]).

## Constraints

- Input must not be mutated
- Duplicate lsns: first wins
- Errors sorted by lsn

## Examples

```
apply_cdc({1: {'id': 1, 'status': 'new'}}, 10, [{'lsn': 12, 'op': 'u', 'key': 1, 'data': {'status': 'paid'}}, {'lsn': 11, 'op': 'c', 'key': 2, 'data': {'id': 2, 'status': 'new'}}])
->  ({1: {'id': 1, 'status': 'paid'}, 2: {'id': 2, 'status': 'new'}}, 12, [])
```

## Hints

- Deduplicate by lsn first, then sort.
- Copy the snapshot shallowly and copy each row before you change it.
- Track last_lsn for every event processed after filtering, including errors.

## Why it matters

CDC is the backbone of near-real-time lakes and warehouses. Ordering by log sequence, ignoring replays and handling partial updates are exactly the issues that corrupt tables when they are missed.

```task
{
  "id": "apply-cdc-change-log",
  "title": "Apply An Out Of Order CDC Log",
  "type": "python",
  "instructions": "Write `apply_cdc(snapshot, snapshot_lsn, events)`. `snapshot` maps primary key to row dict and reflects all changes up to `snapshot_lsn`. Each event has `lsn` (int), `op` ('c' create, 'u' update, 'd' delete), `key` and `data` (full row for 'c', changed fields only for 'u', None for 'd'). Apply events in lsn order, ignoring events with lsn <= snapshot_lsn and duplicate lsns (keep the first one seen). 'c' on an existing key overwrites it. 'u' merges data into the existing row; 'u' on a missing key is not applied and its lsn goes to an `errors` list. 'd' on a missing key is a no-op. Do not mutate the input snapshot or rows. Return `(new_snapshot, last_lsn, errors)` where last_lsn is the highest lsn applied or seen (or snapshot_lsn if none).",
  "starter": "def apply_cdc(snapshot: dict, snapshot_lsn: int, events: list):\n    raise NotImplementedError\n",
  "solution": "def apply_cdc(snapshot: dict, snapshot_lsn: int, events: list):\n    uniq = {}\n    for e in events:\n        if e[\"lsn\"] > snapshot_lsn and e[\"lsn\"] not in uniq:\n            uniq[e[\"lsn\"]] = e\n    out = dict(snapshot)\n    errors, last = [], snapshot_lsn\n    for lsn in sorted(uniq):\n        e = uniq[lsn]\n        k = e[\"key\"]\n        if e[\"op\"] == \"c\":\n            out[k] = dict(e[\"data\"])\n        elif e[\"op\"] == \"u\":\n            if k in out:\n                out[k] = {**out[k], **e[\"data\"]}\n            else:\n                errors.append(lsn)\n        elif e[\"op\"] == \"d\":\n            out.pop(k, None)\n        else:\n            raise ValueError(f\"unknown op {e['op']}\")\n        last = lsn\n    return out, last, errors\n",
  "tests": "r = apply_cdc({1: {'id': 1, 'status': 'new'}}, 10, [{'lsn': 12, 'op': 'u', 'key': 1, 'data': {'status': 'paid'}}, {'lsn': 11, 'op': 'c', 'key': 2, 'data': {'id': 2, 'status': 'new'}}])\nassert r == ({1: {'id': 1, 'status': 'paid'}, 2: {'id': 2, 'status': 'new'}}, 12, [])\nassert apply_cdc({}, 5, []) == ({}, 5, [])\n",
  "hidden": "snap = {1: {'id': 1, 'qty': 1, 'status': 'new'}}\nev = [{'lsn': 5, 'op': 'd', 'key': 1, 'data': None},\n      {'lsn': 21, 'op': 'u', 'key': 1, 'data': {'qty': 3}},\n      {'lsn': 21, 'op': 'd', 'key': 1, 'data': None},\n      {'lsn': 22, 'op': 'u', 'key': 9, 'data': {'qty': 1}},\n      {'lsn': 23, 'op': 'd', 'key': 7, 'data': None}]\nout, last, err = apply_cdc(snap, 20, ev)\nassert out == {1: {'id': 1, 'qty': 3, 'status': 'new'}} and last == 23 and err == [22]\nassert snap == {1: {'id': 1, 'qty': 1, 'status': 'new'}}\nev2 = [{'lsn': 3, 'op': 'c', 'key': 'a', 'data': {'v': 2}}, {'lsn': 2, 'op': 'd', 'key': 'a', 'data': None}, {'lsn': 1, 'op': 'c', 'key': 'a', 'data': {'v': 1}}]\nassert apply_cdc({}, 0, ev2) == ({'a': {'v': 2}}, 3, [])\nassert apply_cdc({}, 0, ev2[1:]) == ({}, 2, [])\no1 = apply_cdc({}, 0, ev2)\nassert apply_cdc(o1[0], o1[1], ev2) == o1\n",
  "explanation": "CDC events carry a log sequence number that defines the true order of changes, so arrival order must be ignored. Filtering by the snapshot lsn and deduplicating by lsn makes replays after a connector restart harmless, which means running the merge twice gives the same result. Updates are partial, so they are merged into a copy of the existing row instead of replacing it. An update for a missing key signals lost history and is reported rather than turned into a half-empty row. Copying rows on write keeps the caller's snapshot untouched."
}
```
