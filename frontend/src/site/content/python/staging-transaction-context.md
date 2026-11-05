---
id: PY-104
title: Staged Writes Context Manager With Rollback
slug: staging-transaction-context
difficulty: Medium
category: advanced
skill: reliability
description: A context manager that stages inventory changes and applies them only if the block succeeds.
topic: python-oop
concepts: __enter__/__exit__, commit/rollback, atomic apply
time: O(c)
space: O(c)
minutes: 15
---

## Scenario

An inventory adjustment job updates many SKUs. If any adjustment fails validation midway, none of the changes should reach the stock table.

## Problem

Write class StagedUpdate(table). Inside `with StagedUpdate(table) as tx:` calls to tx.set(key, value) and tx.delete(key) are staged, and tx.get(key) sees staged changes on top of table (None if absent or deleted). On a clean exit apply all staged changes to table in place. On exception discard them and let the exception propagate. Expose tx.committed (bool).

## Objective

Use the context manager protocol to make a batch of changes atomic.

## Input format

dict table.

## Output format

Mutated table on success.

## Constraints

- Do not touch table until commit
- delete of a missing key is allowed

## Examples

```
with StagedUpdate(stock) as tx: tx.set('A', 5); tx.delete('B')  ->  stock updated only after the block
```

## Hints

- Stage changes in a dict and use a sentinel object for deletes.
- __exit__ gets exc_type; commit only when it is None and return False.

## Why it matters

All-or-nothing writes prevent partial loads, the most common cause of inconsistent tables. This is the same contract a database transaction gives you.

```task
{
  "id": "staging-transaction-context",
  "title": "Staged Writes Context Manager With Rollback",
  "type": "python",
  "instructions": "Write class StagedUpdate(table). Inside `with StagedUpdate(table) as tx:` calls to tx.set(key, value) and tx.delete(key) are staged, and tx.get(key) sees staged changes on top of table (None if absent or deleted). On a clean exit apply all staged changes to table in place. On exception discard them and let the exception propagate. Expose tx.committed (bool).",
  "starter": "class StagedUpdate:\n    def __init__(self, table: dict):\n        raise NotImplementedError\n",
  "solution": "_DEL = object()\n\nclass StagedUpdate:\n    def __init__(self, table: dict):\n        self.table = table\n        self.staged = {}\n        self.committed = False\n\n    def __enter__(self):\n        return self\n\n    def set(self, key, value):\n        self.staged[key] = value\n\n    def delete(self, key):\n        self.staged[key] = _DEL\n\n    def get(self, key):\n        if key in self.staged:\n            v = self.staged[key]\n            return None if v is _DEL else v\n        return self.table.get(key)\n\n    def __exit__(self, exc_type, exc, tb):\n        if exc_type is None:\n            for k, v in self.staged.items():\n                if v is _DEL:\n                    self.table.pop(k, None)\n                else:\n                    self.table[k] = v\n            self.committed = True\n        self.staged = {}\n        return False\n",
  "tests": "stock={'A':1,'B':2}\nwith StagedUpdate(stock) as tx:\n    tx.set('A', 5); tx.delete('B')\n    assert stock == {'A':1,'B':2}\n    assert tx.get('A') == 5 and tx.get('B') is None\nassert stock == {'A':5} and tx.committed\n",
  "hidden": "stock={'A':1}\ntry:\n    with StagedUpdate(stock) as tx:\n        tx.set('A', 9); tx.set('C', 3)\n        raise ValueError('negative stock')\nexcept ValueError:\n    pass\nassert stock == {'A':1} and not tx.committed\nwith StagedUpdate(stock) as tx:\n    tx.delete('ZZ'); tx.set('Z', 0); tx.delete('Z')\n    assert tx.get('A') == 1\nassert stock == {'A':1}\nwith StagedUpdate(stock) as tx:\n    for i in range(5000):\n        tx.set(i, i)\nassert len(stock) == 5001\n",
  "explanation": "All changes go into a staging dict, so the real table is untouched while the block runs. A unique sentinel marks deletes, and get checks the staging area first to give read-your-own-writes behaviour. __exit__ applies the staged changes only when no exception occurred and returns False so errors propagate. Either every change lands or none do."
}
```
