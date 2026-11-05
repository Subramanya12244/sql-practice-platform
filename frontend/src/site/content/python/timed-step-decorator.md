---
id: PY-107
title: Timing Decorator That Records Step Runs
slug: timed-step-decorator
difficulty: Medium
category: advanced
skill: orchestration
description: A decorator factory that records name, duration and status of each call into a list.
topic: python-functions
concepts: decorator factory, functools.wraps, injected clock
time: O(1) per call
space: O(calls)
minutes: 15
---

## Scenario

Data engineers want per-function timings for transform steps without adding timing code into every function.

## Problem

Write timed(registry, clock). It returns a decorator. Each call of the decorated function appends {'name': func.__name__, 'secs': round(end-start, 3), 'ok': bool} to registry, where ok is False if the function raised (the exception still propagates). The wrapper must keep the original __name__ and __doc__.

## Objective

Write a parameterised decorator that records metadata and re-raises errors.

## Input format

registry list, clock callable.

## Output format

decorator.

## Constraints

- Use functools.wraps
- Record even when the function raises

## Examples

```
@timed(reg, clock)\ndef clean(rows): return rows\nclean([1])  ->  reg == [{'name':'clean','secs':1.0,'ok':True}]
```

## Hints

- Three nested functions: factory, decorator, wrapper.
- Use try/finally or except-and-reraise to record in both cases.

## Why it matters

Lightweight instrumentation decorators are common in pipeline code for profiling and run metadata. Recording failures as well as successes gives a full run history.

```task
{
  "id": "timed-step-decorator",
  "title": "Timing Decorator That Records Step Runs",
  "type": "python",
  "instructions": "Write timed(registry, clock). It returns a decorator. Each call of the decorated function appends {'name': func.__name__, 'secs': round(end-start, 3), 'ok': bool} to registry, where ok is False if the function raised (the exception still propagates). The wrapper must keep the original __name__ and __doc__.",
  "starter": "def timed(registry: list, clock):\n    raise NotImplementedError\n",
  "solution": "import functools\n\ndef timed(registry: list, clock):\n    def deco(func):\n        @functools.wraps(func)\n        def wrapper(*args, **kwargs):\n            start, ok = clock(), False\n            try:\n                result = func(*args, **kwargs)\n                ok = True\n                return result\n            finally:\n                registry.append({'name': func.__name__, 'secs': round(clock() - start, 3), 'ok': ok})\n        return wrapper\n    return deco\n",
  "tests": "import itertools\nreg=[]; t=itertools.count(0.0)\n@timed(reg, lambda: next(t))\ndef clean(rows):\n    'Clean rows.'\n    return rows\nassert clean([1]) == [1]\nassert reg == [{'name':'clean','secs':1.0,'ok':True}]\nassert clean.__name__ == 'clean' and clean.__doc__ == 'Clean rows.'\n",
  "hidden": "import itertools\nreg=[]; t=itertools.count(0.0, 0.25)\n@timed(reg, lambda: next(t))\ndef boom(x=1, *, y=2):\n    raise ValueError(x + y)\ntry:\n    boom(y=5); assert False\nexcept ValueError as e:\n    assert e.args == (6,)\nassert reg == [{'name':'boom','secs':0.25,'ok':False}]\n@timed(reg, lambda: 0)\ndef add(a, b): return a + b\nfor i in range(1000): add(i, 1)\nassert len(reg) == 1001 and reg[-1] == {'name':'add','secs':0,'ok':True}\n",
  "explanation": "The outer function captures the registry and clock, returning a normal decorator. The wrapper reads the clock before and after the call, and the finally block guarantees a record is written whether the call returns or raises. ok is set only after a successful return. functools.wraps copies the name and docstring so logs and introspection still see the original function."
}
```
