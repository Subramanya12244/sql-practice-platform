---
id: PY-007
title: Idempotent Upsert into a Dict Table
slug: idempotent-upsert
difficulty: Hard
category: etl
skill: incremental
description: Merge a batch into a keyed in-memory table so re-running the same batch changes nothing.
topic: python-etl-pipelines
concepts: idempotency, upserts, timestamps, statistics
time: O(b)
space: O(b)
minutes: 25
---

## Scenario

A customer table is kept in sync by applying batches of changed rows from a source system, and batches are sometimes delivered twice. Replaying a batch must not change the table or the stats.

## Problem

Write `def upsert(table: dict, batch: list, key: str = "id", ts: str = "updated_at") -> dict` that mutates
`table` (`{key_value: row}`) with rows from `batch` and returns stats `{"inserted": n, "updated": n, "skipped": n}`.
- New key: insert (copy the row).
- Existing key with a strictly newer `ts`: replace the row (update).
- Existing key with an equal or older `ts`, or an identical row: skip.
- Within one batch, duplicate keys are applied in order, so the newest wins.
- Rows missing `key` raise `KeyError`. Running the same batch twice must report 0 inserts and 0 updates the second time.

## Objective

Upsert a batch into a keyed table by timestamp, returning inserted, updated and skipped counts, so reruns are no-ops.

## Input format

A target dict keyed by id and a batch of rows.

## Output format

A dict of inserted/updated/skipped counts.

## Constraints

- Re-running a batch changes nothing
- Older or equal timestamps are skipped

## Examples

```
t = {}
upsert(t, [{"id": 1, "updated_at": 1, "v": "a"}])  ->  {"inserted": 1, "updated": 0, "skipped": 0}
upsert(t, [{"id": 1, "updated_at": 2, "v": "b"}])  ->  {"inserted": 0, "updated": 1, "skipped": 0}
upsert(t, [{"id": 1, "updated_at": 2, "v": "b"}])  ->  {"inserted": 0, "updated": 0, "skipped": 1}
```

## Hints

- Compare `row[ts] > table[k][ts]` for updates.
- Store `dict(row)` so later mutation of the batch cannot change the table.

## Why it matters

Idempotent loads are what make retries and backfills safe, the same guarantee a MERGE statement gives in a warehouse.

```task
{
  "id": "idempotent-upsert",
  "title": "Idempotent Upsert into a Dict Table",
  "type": "python",
  "instructions": "Write `def upsert(table: dict, batch: list, key: str = \"id\", ts: str = \"updated_at\") -> dict` that mutates\n`table` (`{key_value: row}`) with rows from `batch` and returns stats `{\"inserted\": n, \"updated\": n, \"skipped\": n}`.\n- New key: insert (copy the row).\n- Existing key with a strictly newer `ts`: replace the row (update).\n- Existing key with an equal or older `ts`, or an identical row: skip.\n- Within one batch, duplicate keys are applied in order, so the newest wins.\n- Rows missing `key` raise `KeyError`. Running the same batch twice must report 0 inserts and 0 updates the second time.",
  "starter": "def upsert(table: dict, batch: list, key: str = \"id\", ts: str = \"updated_at\") -> dict:\n    raise NotImplementedError\n",
  "solution": "def upsert(table: dict, batch: list, key: str = \"id\", ts: str = \"updated_at\") -> dict:\n    stats = {\"inserted\": 0, \"updated\": 0, \"skipped\": 0}\n    for row in batch:\n        k = row[key]\n        if k not in table:\n            table[k] = dict(row)\n            stats[\"inserted\"] += 1\n        elif row[ts] > table[k][ts]:\n            table[k] = dict(row)\n            stats[\"updated\"] += 1\n        else:\n            stats[\"skipped\"] += 1\n    return stats\n",
  "tests": "t = {}\nb1 = [{\"id\": 1, \"updated_at\": 1, \"v\": \"a\"}, {\"id\": 2, \"updated_at\": 1, \"v\": \"x\"}]\nassert upsert(t, b1) == {\"inserted\": 2, \"updated\": 0, \"skipped\": 0}\nassert upsert(t, b1) == {\"inserted\": 0, \"updated\": 0, \"skipped\": 2}\nassert upsert(t, [{\"id\": 1, \"updated_at\": 0, \"v\": \"old\"}]) == {\"inserted\": 0, \"updated\": 0, \"skipped\": 1}\nassert t[1][\"v\"] == \"a\"\nassert upsert(t, [{\"id\": 3, \"updated_at\": 1, \"v\": \"p\"}, {\"id\": 3, \"updated_at\": 5, \"v\": \"q\"}]) == {\"inserted\": 1, \"updated\": 1, \"skipped\": 0}\n",
  "hidden": "assert t[3][\"v\"] == \"q\"\nb1[0][\"v\"] = \"mutated\"\nassert t[1][\"v\"] == \"a\"\nassert upsert(t, []) == {\"inserted\": 0, \"updated\": 0, \"skipped\": 0}\ntry:\n    upsert(t, [{\"updated_at\": 1}]); assert False\nexcept KeyError:\n    pass\nassert len(t) == 3\n",
  "explanation": "An update only wins if its timestamp is newer, so replaying the same batch (or an older one) skips every row: the load is idempotent. Copying each row with `dict(row)` stops later edits to the batch leaking into the table."
}
```
