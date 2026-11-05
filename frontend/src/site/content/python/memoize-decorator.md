---
id: PY-087
title: Memoise Decorator With Call Counting
slug: memoize-decorator
difficulty: Medium
category: advanced
skill: performance
description: Write a caching decorator that also counts real calls.
topic: python-functions
concepts: decorators, closures, functools.wraps
time: O(1) per cached call
space: O(u)
minutes: 15
---

## Scenario

An enrichment job looks up exchange rates for every transaction, but the same currency and date pair appears thousands of times. Each lookup is slow, so results should be cached and the real calls counted.

## Problem

Write `@memoize` that caches results by positional arguments, keeps the wrapped function's name (functools.wraps), and exposes `wrapper.calls`: how many times the original function actually ran.

## Objective

Write a @memoize decorator that caches by positional arguments, preserves the function name and counts real calls.

## Input format

A function with hashable positional arguments.

## Output format

The decorated function.

## Constraints

- Use functools.wraps

## Examples

```
@memoize
def sq(x): return x * x
sq(3); sq(3); sq.calls  ->  1
```

## Hints

- Store results in a dict keyed by the args tuple.
- Attach `calls` as an attribute of the wrapper function.

## Why it matters

Caching repeated lookups is one of the cheapest performance wins in a pipeline, and decorators let you add it without touching the business logic.

```task
{
  "id": "memoize-decorator",
  "title": "Memoise Decorator With Call Counting",
  "type": "python",
  "instructions": "Write `@memoize` that caches results by positional arguments, keeps the wrapped function's name (functools.wraps), and exposes `wrapper.calls`: how many times the original function actually ran.",
  "starter": "def memoize(fn):\n    raise NotImplementedError\n",
  "solution": "import functools\n\n\ndef memoize(fn):\n    cache = {}\n\n    @functools.wraps(fn)\n    def wrapper(*args):\n        if args not in cache:\n            wrapper.calls += 1\n            cache[args] = fn(*args)\n        return cache[args]\n\n    wrapper.calls = 0\n    return wrapper\n",
  "tests": "@memoize\ndef sq(x):\n    return x * x\nassert sq(3) == 9 and sq(3) == 9\nassert sq.calls == 1\nassert sq.__name__ == 'sq'\n",
  "hidden": "@memoize\ndef fibm(n):\n    return n if n < 2 else fibm(n - 1) + fibm(n - 2)\nassert fibm(80) == 23416728348467685\nassert fibm.calls == 81\n@memoize\ndef add(a, b):\n    return a + b\nadd(1, 2); add(2, 1); add(1, 2)\nassert add.calls == 2\n@memoize\ndef nothing():\n    return None\nnothing(); nothing()\nassert nothing.calls == 1\n",
  "explanation": "The decorator returns a closure that remembers `cache`. Checking `args not in cache` (not `cache.get(args)`) caches None results correctly. `functools.wraps` copies the name and docstring onto the wrapper."
}
```
