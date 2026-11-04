---
title: Build a RateLimiter Class
slug: rate-limiter-class
difficulty: Medium
description: Implement a sliding-window rate limiter class for throttling API calls.
topic: python-oop
minutes: 20
---

## Problem

Write `class RateLimiter` with `__init__(self, max_calls: int, period: float)` and
`allow(self, now: float) -> bool`. `allow` returns `True` and records the call if fewer than `max_calls`
calls were allowed in the window `(now - period, now]`; otherwise it returns `False` and records nothing.
Time is passed in explicitly (no clock), so it is testable. Add a `remaining(self, now: float) -> int` method.

## Examples

```
rl = RateLimiter(2, 10)
rl.allow(0), rl.allow(1), rl.allow(2)   ->  True, True, False
rl.allow(10)  ->  True     # the call at t=0 has left the window
```

## Hints

- Keep allowed timestamps in a `collections.deque`.
- Pop from the left while `ts[0] <= now - period`.

```task
{
  "id": "rate-limiter-class",
  "title": "Build a RateLimiter Class",
  "type": "python",
  "instructions": "Write `class RateLimiter` with `__init__(self, max_calls: int, period: float)` and\n`allow(self, now: float) -> bool`. `allow` returns `True` and records the call if fewer than `max_calls`\ncalls were allowed in the window `(now - period, now]`; otherwise it returns `False` and records nothing.\nTime is passed in explicitly (no clock), so it is testable. Add a `remaining(self, now: float) -> int` method.",
  "starter": "class RateLimiter:\n    def __init__(self, max_calls: int, period: float):\n        raise NotImplementedError\n\n    def allow(self, now: float) -> bool:\n        raise NotImplementedError\n\n    def remaining(self, now: float) -> int:\n        raise NotImplementedError\n",
  "solution": "from collections import deque\n\nclass RateLimiter:\n    def __init__(self, max_calls: int, period: float):\n        self.max_calls = max_calls\n        self.period = period\n        self.calls = deque()\n\n    def _evict(self, now):\n        while self.calls and self.calls[0] <= now - self.period:\n            self.calls.popleft()\n\n    def allow(self, now: float) -> bool:\n        self._evict(now)\n        if len(self.calls) < self.max_calls:\n            self.calls.append(now)\n            return True\n        return False\n\n    def remaining(self, now: float) -> int:\n        self._evict(now)\n        return self.max_calls - len(self.calls)\n",
  "tests": "rl = RateLimiter(2, 10)\nassert rl.allow(0) is True\nassert rl.allow(1) is True\nassert rl.allow(2) is False\nassert rl.remaining(5) == 0\nassert rl.allow(10) is True\nassert rl.allow(10.5) is False\nassert rl.remaining(11) == 1\nz = RateLimiter(0, 5)\nassert z.allow(0) is False\nother = RateLimiter(1, 1)\nassert other.allow(0) is True and rl is not other\n"
}
```
