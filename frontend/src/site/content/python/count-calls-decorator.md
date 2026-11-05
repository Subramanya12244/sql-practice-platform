---
id: PY-028
title: Count Calls Decorator
slug: count-calls-decorator
difficulty: Easy
category: advanced
skill: reliability
description: Write a decorator that counts how often a pipeline step runs.
topic: python-functions
concepts: decorators, functools.wraps, function attributes
time: O(1)
space: O(1)
minutes: 8
---

## Scenario

The team wants simple metrics on how many times each transform function is called during a run, without editing every function.

## Problem

Write decorator `count_calls(func)` that returns a wrapper which calls func with all arguments, increments `wrapper.calls` (starting at 0) on every call, and keeps func's __name__ via functools.wraps. Calls that raise still count.

## Objective

Write a decorator that counts every call to the wrapped function, failed calls included, and keeps its name.

## Input format

A function.

## Output format

A wrapped function with a .calls attribute.

## Constraints

- Use functools.wraps

## Examples

```
@count_calls
def clean(x): return x.strip()
clean(' a '); clean.calls  ->  1
```

## Hints

- Define wrapper(*args, **kwargs) inside the decorator.
- Increment before calling func so failures count too.

## Why it matters

Decorators add metrics, logging and retries to pipeline steps without touching their code. This is the smallest useful example of that pattern.

```task
{
  "id": "count-calls-decorator",
  "title": "Count Calls Decorator",
  "type": "python",
  "instructions": "Write decorator `count_calls(func)` that returns a wrapper which calls func with all arguments, increments `wrapper.calls` (starting at 0) on every call, and keeps func's __name__ via functools.wraps. Calls that raise still count.",
  "starter": "def count_calls(func):\n    raise NotImplementedError\n",
  "solution": "import functools\n\ndef count_calls(func):\n    @functools.wraps(func)\n    def wrapper(*args, **kwargs):\n        wrapper.calls += 1\n        return func(*args, **kwargs)\n    wrapper.calls = 0\n    return wrapper\n",
  "tests": "@count_calls\ndef clean(x):\n    return x.strip()\nassert clean(' a ') == 'a'\nassert clean.calls == 1\nassert clean.__name__ == 'clean'\n",
  "hidden": "@count_calls\ndef f(a, b=1):\n    return a + b\nassert f.calls == 0\nassert f(1, b=2) == 3\nfor _ in range(99):\n    f(0)\nassert f.calls == 100\n@count_calls\ndef boom():\n    raise ValueError\ntry:\n    boom()\nexcept ValueError:\n    pass\nassert boom.calls == 1\n",
  "explanation": "The wrapper stores its counter as a function attribute and bumps it before delegating, so failed calls are counted. functools.wraps copies the name and docstring."
}
```
