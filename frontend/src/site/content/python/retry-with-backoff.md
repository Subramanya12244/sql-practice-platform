---
title: Retry with Exponential Backoff
slug: retry-with-backoff
difficulty: Medium
description: Wrap a flaky call with retries, exponential backoff and a whitelist of retryable errors.
topic: python-api-integration
minutes: 20
---

## Problem

Write `def retry(func, attempts: int = 3, base_delay: float = 0.01, retry_on=(ConnectionError,), sleep=time.sleep)`
that calls `func()` and returns its result. On an exception in `retry_on`, wait `base_delay * 2**k`
(k = 0, 1, ...) via `sleep` and try again, up to `attempts` total calls; then re-raise the last error.
Other exceptions propagate immediately. Keep all delays tiny (well under 0.05 s).

## Examples

```
# func fails twice with ConnectionError, then returns "ok"
retry(func, attempts=3)  ->  "ok"   # sleeps 0.01 then 0.02
```

## Hints

- Loop `for k in range(attempts)` and `return` on success.
- Do not sleep after the final failed attempt; just `raise`.

```task
{
  "id": "retry-with-backoff",
  "title": "Retry with Exponential Backoff",
  "type": "python",
  "instructions": "Write `def retry(func, attempts: int = 3, base_delay: float = 0.01, retry_on=(ConnectionError,), sleep=time.sleep)`\nthat calls `func()` and returns its result. On an exception in `retry_on`, wait `base_delay * 2**k`\n(k = 0, 1, ...) via `sleep` and try again, up to `attempts` total calls; then re-raise the last error.\nOther exceptions propagate immediately. Keep all delays tiny (well under 0.05 s).",
  "starter": "import time\n\ndef retry(func, attempts: int = 3, base_delay: float = 0.01, retry_on=(ConnectionError,), sleep=time.sleep):\n    raise NotImplementedError\n",
  "solution": "import time\n\ndef retry(func, attempts: int = 3, base_delay: float = 0.01, retry_on=(ConnectionError,), sleep=time.sleep):\n    for k in range(attempts):\n        try:\n            return func()\n        except retry_on:\n            if k == attempts - 1:\n                raise\n            sleep(base_delay * 2 ** k)\n",
  "tests": "def flaky(n, exc=ConnectionError):\n    state = {\"calls\": 0}\n    def f():\n        state[\"calls\"] += 1\n        if state[\"calls\"] <= n:\n            raise exc(\"boom\")\n        return \"ok\"\n    return f, state\ndelays = []\nf, s = flaky(2)\nassert retry(f, attempts=3, sleep=delays.append) == \"ok\"\nassert s[\"calls\"] == 3 and delays == [0.01, 0.02]\nf, s = flaky(5)\ntry:\n    retry(f, attempts=3, sleep=lambda d: None); assert False\nexcept ConnectionError:\n    pass\nassert s[\"calls\"] == 3\nf, s = flaky(1, ValueError)\ntry:\n    retry(f, attempts=3, sleep=lambda d: None); assert False\nexcept ValueError:\n    pass\nassert s[\"calls\"] == 1\nf, s = flaky(1)\nassert retry(f, attempts=2, base_delay=0.001) == \"ok\"\n"
}
```
