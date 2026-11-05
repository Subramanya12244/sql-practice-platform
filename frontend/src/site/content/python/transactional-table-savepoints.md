---
id: PY-131
title: In Memory Table With Nested Transactions
slug: transactional-table-savepoints
difficulty: Hard
category: advanced
skill: reliability
description: A keyed table whose transaction() context manager supports nested savepoints and rolls back exactly the failed scope.
topic: python-oop
concepts: context managers, undo log, savepoints, rollback semantics
time: O(1) per change, O(changes) per rollback
space: O(changes in open transactions)
minutes: 40
---

## Scenario

An in-process staging layer applies inventory adjustments before flushing them to the warehouse. If one adjustment in a group fails, only that group should be undone, mirroring database savepoints.

## Problem

Implement class `Table` with `insert(key, row)` (KeyError if present), `update(key, **fields)` (KeyError if missing, merges fields), `delete(key)` (KeyError if missing), `get(key)` (a copy, or None) and `all()` (dict of copies). `transaction()` is a context manager yielding the table. If the block raises, every change made inside that block (including inside nested transactions that committed) is undone and the exception re-raised. If it exits normally, the changes are kept; for a nested transaction they still roll back if an enclosing transaction later fails. Outside any transaction, changes apply immediately. Stored rows must not be affected by callers mutating dicts they passed in or got back.

## Objective

Implement savepoint-style nested transactions with an undo log.

## Input format

Method calls on Table.

## Output format

Table state after commits and rollbacks.

## Constraints

- Undo only what the failed scope changed
- Exceptions propagate
- Store copies

## Examples

```
t = Table(); t.insert('A1', {'qty': 5})
with t.transaction(): t.update('A1', qty=4); raise ValueError  ->  ValueError, t.get('A1') == {'qty': 5}
```

## Hints

- Keep a stack of undo dicts, one per open transaction: key -> value before the first change in that scope (or a MISSING sentinel).
- On rollback restore entries from the popped dict; on commit merge it into the parent with setdefault so the oldest value wins.
- Record the old value before every mutation, only if the key is not already in the top undo dict.

## Why it matters

Understanding commit, rollback and savepoints at this level makes database transaction behaviour and staging-table patterns far less mysterious. The undo-log technique is the same one databases use to abort transactions.

```task
{
  "id": "transactional-table-savepoints",
  "title": "In Memory Table With Nested Transactions",
  "type": "python",
  "instructions": "Implement class `Table` with `insert(key, row)` (KeyError if present), `update(key, **fields)` (KeyError if missing, merges fields), `delete(key)` (KeyError if missing), `get(key)` (a copy, or None) and `all()` (dict of copies). `transaction()` is a context manager yielding the table. If the block raises, every change made inside that block (including inside nested transactions that committed) is undone and the exception re-raised. If it exits normally, the changes are kept; for a nested transaction they still roll back if an enclosing transaction later fails. Outside any transaction, changes apply immediately. Stored rows must not be affected by callers mutating dicts they passed in or got back.",
  "starter": "class Table:\n    def __init__(self):\n        raise NotImplementedError\n",
  "solution": "import copy\nfrom contextlib import contextmanager\n\n_MISSING = object()\n\n\nclass Table:\n    def __init__(self):\n        self._rows = {}\n        self._undo = []\n\n    def _remember(self, key):\n        if self._undo and key not in self._undo[-1]:\n            self._undo[-1][key] = copy.deepcopy(self._rows[key]) if key in self._rows else _MISSING\n\n    def insert(self, key, row):\n        if key in self._rows:\n            raise KeyError(key)\n        self._remember(key)\n        self._rows[key] = copy.deepcopy(row)\n\n    def update(self, key, **fields):\n        if key not in self._rows:\n            raise KeyError(key)\n        self._remember(key)\n        self._rows[key].update(copy.deepcopy(fields))\n\n    def delete(self, key):\n        if key not in self._rows:\n            raise KeyError(key)\n        self._remember(key)\n        del self._rows[key]\n\n    def get(self, key):\n        return copy.deepcopy(self._rows.get(key))\n\n    def all(self):\n        return copy.deepcopy(self._rows)\n\n    @contextmanager\n    def transaction(self):\n        self._undo.append({})\n        try:\n            yield self\n        except BaseException:\n            for key, old in self._undo.pop().items():\n                if old is _MISSING:\n                    self._rows.pop(key, None)\n                else:\n                    self._rows[key] = old\n            raise\n        else:\n            done = self._undo.pop()\n            if self._undo:\n                for key, old in done.items():\n                    self._undo[-1].setdefault(key, old)\n",
  "tests": "t = Table()\nt.insert('A1', {'qty': 5})\ntry:\n    with t.transaction():\n        t.update('A1', qty=4)\n        raise ValueError('bad adjustment')\nexcept ValueError:\n    pass\nassert t.get('A1') == {'qty': 5}\nwith t.transaction():\n    t.insert('B2', {'qty': 1})\nassert t.all() == {'A1': {'qty': 5}, 'B2': {'qty': 1}}\n",
  "hidden": "t = Table()\nt.insert('a', {'qty': 1})\nwith t.transaction():\n    t.update('a', qty=2)\n    try:\n        with t.transaction():\n            t.insert('b', {'qty': 9})\n            t.delete('a')\n            raise RuntimeError\n    except RuntimeError:\n        pass\n    assert t.all() == {'a': {'qty': 2}}\n    t.insert('c', {'qty': 3})\nassert t.all() == {'a': {'qty': 2}, 'c': {'qty': 3}}\ntry:\n    with t.transaction():\n        with t.transaction():\n            t.update('c', qty=30)\n            t.delete('a')\n            t.insert('a', {'qty': 100})\n        t.update('a', qty=101)\n        raise KeyError('outer fails')\nexcept KeyError:\n    pass\nassert t.all() == {'a': {'qty': 2}, 'c': {'qty': 3}}\ntry:\n    t.insert('a', {})\n    raise AssertionError('expected KeyError')\nexcept KeyError:\n    pass\ntry:\n    t.update('zz', qty=1)\n    raise AssertionError('expected KeyError')\nexcept KeyError:\n    pass\ntry:\n    t.delete('zz')\n    raise AssertionError('expected KeyError')\nexcept KeyError:\n    pass\nrow = {'qty': 7, 'tags': ['x']}\nt.insert('d', row); row['tags'].append('y')\nassert t.get('d') == {'qty': 7, 'tags': ['x']}\ng = t.get('d'); g['qty'] = 0\nassert t.get('d')['qty'] == 7 and t.get('nope') is None\nwith t.transaction() as same:\n    assert same is t\n",
  "explanation": "Each open transaction owns an undo dict that records the value a key had before the first change inside that scope, or a sentinel if the key did not exist. Rolling back restores those values, which reverses inserts, updates and deletes in one pass. When a nested scope commits, its undo entries merge into the parent with setdefault, so the parent remembers the oldest value and can still roll back everything if it later fails. Deep copies on the way in and out isolate stored rows from callers. The context manager re-raises after rollback so failures stay visible to the caller."
}
```
