---
id: PY-117
title: Atomic File Writer Context Manager
slug: atomic-file-replace
difficulty: Hard
category: files
skill: reliability
description: A context manager that writes to a temp file and swaps it into place only if the block succeeds and validation passes.
topic: python-file-handling
concepts: context managers, temp files, os.replace, rollback, validation hook
time: O(size of data)
space: O(1)
minutes: 30
---

## Scenario

A job regenerates the daily product catalog file that downstream services read. A crash halfway through used to leave a truncated catalog in place, which took the storefront down.

## Problem

Write a context manager `atomic_write(path, validate=None)` that yields a writable text file object. Writes go to `path + '.tmp'`. If the block exits normally, close the temp file, call `validate(tmp_path)` if given (it returns True or False) and on True atomically replace `path` with it via os.replace. If validation returns False, delete the temp file and raise ValueError. If the block raises, close and delete the temp file and re-raise the original exception. In every outcome the temp file must be gone and the original file at `path` must be untouched unless the replace happened.

## Objective

Design a crash-safe write primitive with commit and rollback semantics.

## Input format

A file path and an optional validator callable.

## Output format

A context manager yielding a file object.

## Constraints

- Original content preserved on failure
- No .tmp file left behind
- Exceptions from the block propagate unchanged

## Examples

```
with atomic_write('catalog.csv') as f: f.write('sku\nA1\n')
open('catalog.csv').read()  ->  'sku\nA1\n'
```

## Hints

- contextlib.contextmanager with try/except/else around the yield is the shortest route.
- Close the temp file before validating or replacing it.
- Use a finally that removes the temp file if it still exists.

## Why it matters

Atomic replace is how you publish files that other systems read without ever exposing a half-written state. The same commit-or-rollback thinking applies to tables, partitions and object storage.

```task
{
  "id": "atomic-file-replace",
  "title": "Atomic File Writer Context Manager",
  "type": "python",
  "instructions": "Write a context manager `atomic_write(path, validate=None)` that yields a writable text file object. Writes go to `path + '.tmp'`. If the block exits normally, close the temp file, call `validate(tmp_path)` if given (it returns True or False) and on True atomically replace `path` with it via os.replace. If validation returns False, delete the temp file and raise ValueError. If the block raises, close and delete the temp file and re-raise the original exception. In every outcome the temp file must be gone and the original file at `path` must be untouched unless the replace happened.",
  "starter": "def atomic_write(path: str, validate=None):\n    raise NotImplementedError\n",
  "solution": "import os\nfrom contextlib import contextmanager\n\n\n@contextmanager\ndef atomic_write(path: str, validate=None):\n    tmp = path + \".tmp\"\n    f = open(tmp, \"w\")\n    try:\n        try:\n            yield f\n        finally:\n            f.close()\n        if validate is not None and not validate(tmp):\n            raise ValueError(\"validation failed\")\n        os.replace(tmp, path)\n    finally:\n        if os.path.exists(tmp):\n            os.remove(tmp)\n",
  "tests": "import os\nwith atomic_write('catalog.csv') as f:\n    f.write('sku\\nA1\\n')\nassert open('catalog.csv').read() == 'sku\\nA1\\n'\nassert not os.path.exists('catalog.csv.tmp')\n",
  "hidden": "import os\nopen('c.csv', 'w').write('old')\ntry:\n    with atomic_write('c.csv') as f:\n        f.write('half')\n        raise KeyError('boom')\nexcept KeyError as e:\n    assert e.args == ('boom',)\nelse:\n    raise AssertionError('expected KeyError')\nassert open('c.csv').read() == 'old' and not os.path.exists('c.csv.tmp')\ntry:\n    with atomic_write('c.csv', validate=lambda p: os.path.getsize(p) > 0) as f:\n        pass\n    raise AssertionError('expected ValueError')\nexcept ValueError:\n    pass\nassert open('c.csv').read() == 'old' and not os.path.exists('c.csv.tmp')\nseen = []\ndef v(p):\n    seen.append(open(p).read())\n    return True\nwith atomic_write('c.csv', validate=v) as f:\n    f.write('new')\nassert seen == ['new'] and open('c.csv').read() == 'new'\nwith atomic_write('fresh.txt') as f:\n    f.write('x')\nassert open('fresh.txt').read() == 'x' and sorted(p for p in os.listdir('.') if p.endswith('.tmp')) == []\n",
  "explanation": "Readers never see a partial file because data is first written to a sibling temp file and then swapped in with os.replace, which is atomic on the same filesystem. Closing the temp file before validation ensures all buffered data is flushed and inspectable. If the block raises or validation fails, the replace never happens, so the original file is left exactly as it was. The outer finally deletes any leftover temp file, which keeps directories clean after crashes. The original exception propagates unchanged so callers can still handle it."
}
```
