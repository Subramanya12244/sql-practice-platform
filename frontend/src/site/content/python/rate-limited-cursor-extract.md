---
id: PY-142
title: Rate Limited Cursor Pagination Extract
slug: rate-limited-cursor-extract
difficulty: Hard
category: etl
skill: ingestion
description: Pull every page from a cursor-paginated API while respecting a rolling rate limit, honouring 429 retry-after and detecting cursor loops.
topic: python-api-integration
concepts: cursor pagination, sliding-window rate limit, 429 handling, injected clock
time: O(pages + items)
space: O(items + max_calls)
minutes: 40
---

## Scenario

The billing vendor's invoice API returns 100 invoices per page with a next cursor and allows only a few calls per rolling window. Exceeding it returns HTTP 429, and a known vendor bug sometimes returns a cursor that was already visited.

## Problem

Write `extract_all(fetch, clock, sleep, max_calls, window, max_429=3)`. `fetch(cursor)` (first call with None) returns either `{'status': 200, 'items': [...], 'next': cursor_or_None}` or `{'status': 429, 'retry_after': seconds}`. Before each call, drop call times older than or equal to `clock() - window`; if `max_calls` calls remain in the window, `sleep` until the oldest one expires. Every call (including 429s) counts toward the limit. On 429, sleep retry_after and retry the same cursor; more than max_429 consecutive 429s raises RuntimeError. Any other status raises RuntimeError. Deduplicate items by their `id` across pages, keeping the first. If `next` is a cursor already fetched successfully, raise RuntimeError. Return the list of items.

## Objective

Write a robust paginated extractor that is polite to the API and testable without real time.

## Input format

Callables fetch, clock and sleep, plus limit settings.

## Output format

A list of item dicts.

## Constraints

- Never sleep with real time
- Items with duplicate id kept once
- Loop detection must not hang

## Examples

```
pages = {None: ([{'id': 1}], 'p2'), 'p2': ([{'id': 2}], None)}
extract_all(fake_fetch, clock, sleep, max_calls=1, window=10)  ->  [{'id': 1}, {'id': 2}] with one sleep of 10
```

## Hints

- Keep a deque of call timestamps; pop from the left while they are outside the window.
- After sleeping, read clock() again before recording the new call.
- Track successfully fetched cursors in a set to detect loops.

## Why it matters

Most SaaS ingestion jobs are exactly this loop, and rate limits, 429s and buggy cursors are the usual reasons they break. Injecting clock and sleep lets you prove the throttling logic in milliseconds.

```task
{
  "id": "rate-limited-cursor-extract",
  "title": "Rate Limited Cursor Pagination Extract",
  "type": "python",
  "instructions": "Write `extract_all(fetch, clock, sleep, max_calls, window, max_429=3)`. `fetch(cursor)` (first call with None) returns either `{'status': 200, 'items': [...], 'next': cursor_or_None}` or `{'status': 429, 'retry_after': seconds}`. Before each call, drop call times older than or equal to `clock() - window`; if `max_calls` calls remain in the window, `sleep` until the oldest one expires. Every call (including 429s) counts toward the limit. On 429, sleep retry_after and retry the same cursor; more than max_429 consecutive 429s raises RuntimeError. Any other status raises RuntimeError. Deduplicate items by their `id` across pages, keeping the first. If `next` is a cursor already fetched successfully, raise RuntimeError. Return the list of items.",
  "starter": "def extract_all(fetch, clock, sleep, max_calls: int, window: float, max_429: int = 3) -> list:\n    raise NotImplementedError\n",
  "solution": "from collections import deque\n\n\ndef extract_all(fetch, clock, sleep, max_calls: int, window: float, max_429: int = 3) -> list:\n    calls, items, ids, fetched = deque(), [], set(), set()\n    cursor, consecutive = None, 0\n    while True:\n        now = clock()\n        while calls and calls[0] <= now - window:\n            calls.popleft()\n        if len(calls) >= max_calls:\n            sleep(calls[0] + window - now)\n            now = clock()\n            while calls and calls[0] <= now - window:\n                calls.popleft()\n        calls.append(now)\n        resp = fetch(cursor)\n        if resp[\"status\"] == 429:\n            consecutive += 1\n            if consecutive > max_429:\n                raise RuntimeError(\"too many 429 responses\")\n            sleep(resp[\"retry_after\"])\n            continue\n        if resp[\"status\"] != 200:\n            raise RuntimeError(f\"bad status {resp['status']}\")\n        consecutive = 0\n        fetched.add(cursor)\n        for it in resp[\"items\"]:\n            if it[\"id\"] not in ids:\n                ids.add(it[\"id\"])\n                items.append(it)\n        nxt = resp[\"next\"]\n        if nxt is None:\n            return items\n        if nxt in fetched:\n            raise RuntimeError(f\"cursor loop at {nxt}\")\n        cursor = nxt\n",
  "tests": "class Clock:\n    def __init__(self):\n        self.t, self.sleeps = 0.0, []\n    def __call__(self):\n        return self.t\n    def sleep(self, s):\n        self.sleeps.append(s)\n        self.t += s\nc = Clock()\npages = {None: ([{'id': 1}], 'p2'), 'p2': ([{'id': 2}], None)}\nfetch = lambda cur: {'status': 200, 'items': pages[cur][0], 'next': pages[cur][1]}\nassert extract_all(fetch, c, c.sleep, max_calls=1, window=10) == [{'id': 1}, {'id': 2}]\nassert c.sleeps == [10]\n",
  "hidden": "class Clock:\n    def __init__(self):\n        self.t, self.sleeps = 0.0, []\n    def __call__(self):\n        return self.t\n    def sleep(self, s):\n        self.sleeps.append(s)\n        self.t += s\nc = Clock()\nlog = []\npages = {None: ([{'id': i} for i in range(3)], 'b'), 'b': ([{'id': 2}, {'id': 3}], 'c'), 'c': ([{'id': 4}], 'd'), 'd': ([], 'e'), 'e': ([{'id': 5}], None)}\ndef fetch(cur):\n    log.append((c.t, cur))\n    c.t += 1\n    return {'status': 200, 'items': pages[cur][0], 'next': pages[cur][1]}\nout = extract_all(fetch, c, c.sleep, max_calls=2, window=10)\nassert [i['id'] for i in out] == [0, 1, 2, 3, 4, 5]\nassert [t for t, _ in log] == [0, 1, 10, 11, 20] and c.sleeps == [8, 8]\nc = Clock()\nstate = {'n': 0}\ndef throttled(cur):\n    state['n'] += 1\n    if state['n'] <= 2:\n        return {'status': 429, 'retry_after': 3}\n    return {'status': 200, 'items': [{'id': 'x'}], 'next': None}\nassert extract_all(throttled, c, c.sleep, max_calls=100, window=60) == [{'id': 'x'}] and c.sleeps == [3, 3]\nc = Clock()\ntry:\n    extract_all(lambda cur: {'status': 429, 'retry_after': 1}, c, c.sleep, 100, 60, max_429=3)\n    raise AssertionError('expected RuntimeError')\nexcept RuntimeError:\n    pass\nassert c.sleeps == [1, 1, 1]\nc = Clock()\nloop = {None: 'a', 'a': 'b', 'b': 'a'}\ntry:\n    extract_all(lambda cur: {'status': 200, 'items': [], 'next': loop[cur]}, c, c.sleep, 100, 60)\n    raise AssertionError('expected RuntimeError')\nexcept RuntimeError:\n    pass\ntry:\n    extract_all(lambda cur: {'status': 500}, c, c.sleep, 100, 60)\n    raise AssertionError('expected RuntimeError')\nexcept RuntimeError:\n    pass\n",
  "explanation": "A deque of call timestamps implements a sliding-window limiter: expired timestamps are dropped from the left, and if the window is full the extractor sleeps exactly until the oldest call expires. Counting 429 responses as calls keeps the limiter honest about what the vendor actually saw. Retrying the same cursor after retry_after and capping consecutive 429s avoids both data loss and infinite loops. Remembering fetched cursors catches the vendor's loop bug, and deduplicating by id handles pages that overlap when data shifts during pagination. Because clock and sleep are injected, the whole timing behaviour is tested deterministically without waiting."
}
```
