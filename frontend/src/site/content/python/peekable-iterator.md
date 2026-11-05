---
id: PY-137
title: Peekable Iterator
slug: peekable-iterator
difficulty: Hard
category: advanced
skill: streaming
description: An iterator wrapper that can look ahead without consuming.
topic: python-oop
concepts: iterator protocol, buffering, sentinels
time: O(1) per operation
space: O(1)
minutes: 20
---

## Scenario

A parser reads a stream of log records where it must look at the next record to decide whether it continues the current multi-line entry. It cannot rewind the stream.

## Problem

`Peekable(iterable)` is an iterator with `peek(default=<raise>)` returning the next item without consuming it (StopIteration when exhausted and no default), `__next__`, and `__bool__` (True if more items remain).

## Objective

Build a Peekable iterator with peek, __next__ and __bool__ that buffers one item without consuming it.

## Input format

Any iterable.

## Output format

An iterator.

## Constraints

- Works with infinite iterators
- None is a valid item

## Examples

```
p = Peekable([1, 2]); p.peek()  ->  1; next(p)  ->  1; list(p)  ->  [2]
```

## Hints

- Buffer at most one item.
- Use a private sentinel to tell 'nothing buffered' from a buffered None.

## Why it matters

Lookahead over streams is needed for grouping and multi-line parsing, and implementing the iterator protocol shows how to build reusable stream components.

```task
{
  "id": "peekable-iterator",
  "title": "Peekable Iterator",
  "type": "python",
  "instructions": "`Peekable(iterable)` is an iterator with `peek(default=<raise>)` returning the next item without consuming it (StopIteration when exhausted and no default), `__next__`, and `__bool__` (True if more items remain).",
  "starter": "class Peekable:\n    def __init__(self, iterable):\n        raise NotImplementedError\n",
  "solution": "_EMPTY = object()\n\n\nclass Peekable:\n    def __init__(self, iterable):\n        self._it = iter(iterable)\n        self._buf = _EMPTY\n\n    def __iter__(self):\n        return self\n\n    def peek(self, default=_EMPTY):\n        if self._buf is _EMPTY:\n            try:\n                self._buf = next(self._it)\n            except StopIteration:\n                if default is _EMPTY:\n                    raise\n                return default\n        return self._buf\n\n    def __next__(self):\n        if self._buf is not _EMPTY:\n            v, self._buf = self._buf, _EMPTY\n            return v\n        return next(self._it)\n\n    def __bool__(self):\n        return self.peek(_EMPTY_MARK) is not _EMPTY_MARK\n\n\n_EMPTY_MARK = object()\n",
  "tests": "p = Peekable([1, 2])\nassert p.peek() == 1 and next(p) == 1\nassert list(p) == [2]\n",
  "hidden": "p = Peekable([None, 0])\nassert p.peek() is None and bool(p) is True and next(p) is None\nassert next(p) == 0 and bool(p) is False\nassert p.peek('d') == 'd'\ntry:\n    p.peek()\n    raise AssertionError('expected StopIteration')\nexcept StopIteration:\n    pass\nimport itertools\nq = Peekable(itertools.count())\nassert q.peek() == 0 and q.peek() == 0 and next(q) == 0 and q.peek() == 1\n",
  "explanation": "Buffering one item makes look-ahead possible without losing it; the sentinel object distinguishes 'empty buffer' from a real None item. Defining __bool__ in terms of peek lets `while p:` loops work naturally."
}
```
