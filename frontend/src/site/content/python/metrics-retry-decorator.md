---
id: PY-125
title: Decorator For Retries And Call Metrics
slug: metrics-retry-decorator
difficulty: Hard
category: advanced
skill: reliability
description: A configurable decorator that retries selected exceptions and records calls, successes, failures, retries and time per function.
topic: python-functions
concepts: decorators with arguments, functools.wraps, exception filtering, injected clock
time: O(max_attempts) per call
space: O(functions)
minutes: 30
---

## Scenario

Loader functions across the codebase each hand-roll try/except loops and nobody knows which ones fail most. The team wants one decorator that adds retries for chosen exceptions and publishes per-function metrics to a shared registry.

## Problem

Write `instrumented(metrics, clock, retry_on=(), max_attempts=1)`, a decorator factory. The wrapped function keeps its `__name__` and `__doc__`. `metrics[func.__name__]` is created on first call as `{'calls': 0, 'successes': 0, 'failures': 0, 'retries': 0, 'total_time': 0}`. Each call increments calls, then tries the function up to max_attempts times, retrying only exceptions that are instances of `retry_on` (each retry increments retries). On success increment successes and return the result. If the error is not retryable or attempts are exhausted, increment failures and re-raise the original exception. Add `clock()` at exit minus `clock()` at entry to total_time in every outcome.

## Objective

Build a reusable decorator that combines reliability and observability without changing function signatures.

## Input format

A metrics dict, a clock callable, a tuple of exception types and max attempts.

## Output format

A decorator.

## Constraints

- No real time: use the injected clock
- Original exception propagates
- Positional and keyword args pass through

## Examples

```
m = {}; @instrumented(m, clock, retry_on=(IOError,), max_attempts=3) def load(x): ...
a load that fails once with IOError then returns -> m['load'] == {'calls': 1, 'successes': 1, 'failures': 0, 'retries': 1, 'total_time': ...}
```

## Hints

- Three nested functions: factory(args) -> decorator(func) -> wrapper(*a, **kw).
- isinstance(exc, retry_on) works with a tuple; an empty tuple never matches.
- Use try/finally around the attempt loop to add elapsed time.

## Why it matters

Decorators are how data platforms add cross-cutting retries, timing and metrics to hundreds of tasks without copy-paste. Getting wraps, exception filtering and accounting right is what makes those metrics trustworthy.

```task
{
  "id": "metrics-retry-decorator",
  "title": "Decorator For Retries And Call Metrics",
  "type": "python",
  "instructions": "Write `instrumented(metrics, clock, retry_on=(), max_attempts=1)`, a decorator factory. The wrapped function keeps its `__name__` and `__doc__`. `metrics[func.__name__]` is created on first call as `{'calls': 0, 'successes': 0, 'failures': 0, 'retries': 0, 'total_time': 0}`. Each call increments calls, then tries the function up to max_attempts times, retrying only exceptions that are instances of `retry_on` (each retry increments retries). On success increment successes and return the result. If the error is not retryable or attempts are exhausted, increment failures and re-raise the original exception. Add `clock()` at exit minus `clock()` at entry to total_time in every outcome.",
  "starter": "def instrumented(metrics: dict, clock, retry_on=(), max_attempts: int = 1):\n    raise NotImplementedError\n",
  "solution": "import functools\n\n\ndef instrumented(metrics: dict, clock, retry_on=(), max_attempts: int = 1):\n    def deco(func):\n        @functools.wraps(func)\n        def wrapper(*args, **kwargs):\n            m = metrics.setdefault(func.__name__, {\"calls\": 0, \"successes\": 0, \"failures\": 0, \"retries\": 0, \"total_time\": 0})\n            m[\"calls\"] += 1\n            start = clock()\n            try:\n                attempt = 1\n                while True:\n                    try:\n                        result = func(*args, **kwargs)\n                    except Exception as exc:\n                        if isinstance(exc, retry_on) and attempt < max_attempts:\n                            m[\"retries\"] += 1\n                            attempt += 1\n                            continue\n                        m[\"failures\"] += 1\n                        raise\n                    m[\"successes\"] += 1\n                    return result\n            finally:\n                m[\"total_time\"] += clock() - start\n        return wrapper\n    return deco\n",
  "tests": "t = [0]\ndef clock():\n    t[0] += 1\n    return t[0]\nm = {}\nfails = [1]\n@instrumented(m, clock, retry_on=(IOError,), max_attempts=3)\ndef load(x):\n    \"\"\"Load x.\"\"\"\n    if fails[0]:\n        fails[0] -= 1\n        raise IOError('flaky')\n    return x * 2\nassert load(21) == 42\nassert m['load'] == {'calls': 1, 'successes': 1, 'failures': 0, 'retries': 1, 'total_time': 1}\nassert load.__name__ == 'load' and load.__doc__ == 'Load x.'\n",
  "hidden": "now = [0.0]\nclock = lambda: now[0]\nm = {}\n@instrumented(m, clock, retry_on=(ConnectionError, TimeoutError), max_attempts=3)\ndef fetch(page, *, size=10):\n    now[0] += 2\n    if page == 'bad':\n        raise ValueError('schema')\n    if page == 'down':\n        raise TimeoutError('slow')\n    return (page, size)\nassert fetch(1, size=5) == (1, 5)\ntry:\n    fetch('bad')\n    raise AssertionError\nexcept ValueError as e:\n    assert str(e) == 'schema'\ntry:\n    fetch('down')\n    raise AssertionError\nexcept TimeoutError:\n    pass\nassert m['fetch'] == {'calls': 3, 'successes': 1, 'failures': 2, 'retries': 2, 'total_time': 10.0}\n@instrumented(m, clock)\ndef boom():\n    raise IOError('x')\ntry:\n    boom()\nexcept IOError:\n    pass\nassert m['boom']['retries'] == 0 and m['boom']['failures'] == 1\n@instrumented(m, clock, retry_on=(KeyError,), max_attempts=5)\ndef ok():\n    return None\nassert ok() is None and ok() is None and m['ok']['calls'] == 2 and m['ok']['successes'] == 2\n",
  "explanation": "A decorator factory takes configuration and returns the real decorator, which returns a wrapper; functools.wraps copies the name and docstring so logs and tooling still see the original function. Each call is counted once, while retries are counted per extra attempt, so the metrics distinguish flaky calls from failing ones. isinstance with the retry_on tuple restricts retries to known transient errors, and everything else fails immediately. A bare raise inside the except re-raises the original exception with its traceback. The try/finally guarantees elapsed time is recorded for successes and failures alike."
}
```
