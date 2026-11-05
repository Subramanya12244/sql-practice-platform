---
id: PY-018
title: Retry with Exponential Backoff
slug: retry-with-backoff
difficulty: Medium
category: etl
skill: reliability
description: Wrap a flaky call with retries, exponential backoff and a whitelist of retryable errors.
topic: python-api-integration
concepts: retries, exponential backoff, dependency injection
time: O(attempts)
space: O(1)
minutes: 20
---

## Scenario

A pipeline calls a partner API to fetch daily transactions, and the API occasionally drops connections. The job should retry transient failures with growing waits but fail fast on real bugs.

## Problem

Write `def retry(func, attempts: int = 3, base_delay: float = 0.01, retry_on=(ConnectionError,), sleep=time.sleep)`
that calls `func()` and returns its result. On an exception in `retry_on`, wait `base_delay * 2**k`
(k = 0, 1, ...) via `sleep` and try again, up to `attempts` total calls; then re-raise the last error.
Other exceptions propagate immediately. Keep all delays tiny (well under 0.05 s).

## Objective

Call func with up to attempts tries, sleeping base_delay * 2**k between retryable failures and re-raising the last error.

## Input format

A function to call and retry settings.

## Output format

The function's result, or the last exception.

## Constraints

- Only listed exceptions are retried
- Delays double each time

## Examples

```
# func fails twice with ConnectionError, then returns "ok"
retry(func, attempts=3)  ->  "ok"   # sleeps 0.01 then 0.02
```

## Hints

- Loop `for k in range(attempts)` and `return` on success.
- Do not sleep after the final failed attempt; just `raise`.

## Why it matters

Transient network failures are a fact of life for extraction jobs, and exponential backoff with selective retry keeps jobs resilient without hiding genuine errors.

```task
{
  "id": "retry-with-backoff",
  "title": "Retry with Exponential Backoff",
  "type": "python",
  "instructions": "Write `def retry(func, attempts: int = 3, base_delay: float = 0.01, retry_on=(ConnectionError,), sleep=time.sleep)`\nthat calls `func()` and returns its result. On an exception in `retry_on`, wait `base_delay * 2**k`\n(k = 0, 1, ...) via `sleep` and try again, up to `attempts` total calls; then re-raise the last error.\nOther exceptions propagate immediately. Keep all delays tiny (well under 0.05 s).",
  "starter": "import time\n\ndef retry(func, attempts: int = 3, base_delay: float = 0.01, retry_on=(ConnectionError,), sleep=time.sleep):\n    raise NotImplementedError\n",
  "solution": "import time\n\ndef retry(func, attempts: int = 3, base_delay: float = 0.01, retry_on=(ConnectionError,), sleep=time.sleep):\n    for k in range(attempts):\n        try:\n            return func()\n        except retry_on:\n            if k == attempts - 1:\n                raise\n            sleep(base_delay * 2 ** k)\n",
  "tests": "def flaky(n, exc=ConnectionError):\n    state = {\"calls\": 0}\n    def f():\n        state[\"calls\"] += 1\n        if state[\"calls\"] <= n:\n            raise exc(\"boom\")\n        return \"ok\"\n    return f, state\ndelays = []\nf, s = flaky(2)\nassert retry(f, attempts=3, sleep=delays.append) == \"ok\"\nassert s[\"calls\"] == 3 and delays == [0.01, 0.02]\nf, s = flaky(5)\ntry:\n    retry(f, attempts=3, sleep=lambda d: None); assert False\nexcept ConnectionError:\n    pass\n",
  "hidden": "assert s[\"calls\"] == 3\nf, s = flaky(1, ValueError)\ntry:\n    retry(f, attempts=3, sleep=lambda d: None); assert False\nexcept ValueError:\n    pass\nassert s[\"calls\"] == 1\nf, s = flaky(1)\nassert retry(f, attempts=2, base_delay=0.001) == \"ok\"\n",
  "explanation": "Retrying only specific exceptions avoids hiding real bugs. The delay `base_delay * 2 ** k` doubles after each failure, and passing `sleep` in as a parameter lets tests run instantly while recording the delays."
}
```
