---
id: PY-136
title: Message Processor With Retries And A DLQ
slug: retry-with-dead-letter-queue
difficulty: Hard
category: etl
skill: reliability
description: Process messages with capped exponential backoff for transient errors and route poison messages to a dead-letter queue.
topic: python-exceptions
concepts: exception classification, exponential backoff, dead-letter queue, dependency injection
time: O(messages * max_attempts)
space: O(messages)
minutes: 30
---

## Scenario

An order-events consumer calls a downstream API that sometimes times out. Retrying forever blocks the queue, while dropping failures loses orders, so failed messages must land in a dead-letter queue for replay.

## Problem

Define `TransientError(Exception)` and write `process_messages(messages, handler, sleep, max_attempts=4, base=0.5, cap=4.0)`. For each message dict (with an `id`) call `handler(message)`. If it raises TransientError, call `sleep(min(cap, base * 2 ** (attempt - 1)))` and retry, up to max_attempts total attempts; if all attempts fail add `(id, 'exhausted', attempts)` to the DLQ. Any other exception is permanent: add `(id, ExceptionClassName, attempts)` immediately with no sleep. Messages whose id was already handled (successfully or dead-lettered) in this call are skipped as duplicates. Return `{'ok': [ids], 'dlq': [tuples], 'duplicates': n}` preserving processing order.

## Objective

Separate transient from permanent failures and make retry behaviour testable with an injected sleep.

## Input format

A list of message dicts, a handler, a sleep callable and backoff settings.

## Output format

A dict with ok ids, DLQ tuples and a duplicate count.

## Constraints

- No real sleeping: only call the injected sleep
- No sleep after the last failed attempt
- max_attempts >= 1

## Examples

```
process_messages([{'id': 1}], handler_failing_twice_then_ok, sleeps.append)  ->  {'ok': [1], 'dlq': [], 'duplicates': 0}; sleeps == [0.5, 1.0]
```

## Hints

- Use a while loop over attempts with two except clauses: TransientError first, then Exception.
- Compute the delay from the attempt number that just failed.
- A set of handled ids gives duplicate detection.

## Why it matters

Retry storms and silently lost messages are two of the most common production incidents in data ingestion. A DLQ with error classification and capped backoff is the standard fix, and injecting sleep keeps it testable.

```task
{
  "id": "retry-with-dead-letter-queue",
  "title": "Message Processor With Retries And A DLQ",
  "type": "python",
  "instructions": "Define `TransientError(Exception)` and write `process_messages(messages, handler, sleep, max_attempts=4, base=0.5, cap=4.0)`. For each message dict (with an `id`) call `handler(message)`. If it raises TransientError, call `sleep(min(cap, base * 2 ** (attempt - 1)))` and retry, up to max_attempts total attempts; if all attempts fail add `(id, 'exhausted', attempts)` to the DLQ. Any other exception is permanent: add `(id, ExceptionClassName, attempts)` immediately with no sleep. Messages whose id was already handled (successfully or dead-lettered) in this call are skipped as duplicates. Return `{'ok': [ids], 'dlq': [tuples], 'duplicates': n}` preserving processing order.",
  "starter": "class TransientError(Exception):\n    pass\n\n\ndef process_messages(messages, handler, sleep, max_attempts=4, base=0.5, cap=4.0):\n    raise NotImplementedError\n",
  "solution": "class TransientError(Exception):\n    pass\n\n\ndef process_messages(messages, handler, sleep, max_attempts=4, base=0.5, cap=4.0):\n    ok, dlq, seen, dups = [], [], set(), 0\n    for msg in messages:\n        mid = msg[\"id\"]\n        if mid in seen:\n            dups += 1\n            continue\n        seen.add(mid)\n        attempt = 1\n        while True:\n            try:\n                handler(msg)\n                ok.append(mid)\n                break\n            except TransientError:\n                if attempt >= max_attempts:\n                    dlq.append((mid, \"exhausted\", attempt))\n                    break\n                sleep(min(cap, base * 2 ** (attempt - 1)))\n                attempt += 1\n            except Exception as exc:\n                dlq.append((mid, type(exc).__name__, attempt))\n                break\n    return {\"ok\": ok, \"dlq\": dlq, \"duplicates\": dups}\n",
  "tests": "sleeps, fails = [], {1: 2}\ndef h(m):\n    if fails.get(m['id'], 0) > 0:\n        fails[m['id']] -= 1\n        raise TransientError('timeout')\nassert process_messages([{'id': 1}], h, sleeps.append) == {'ok': [1], 'dlq': [], 'duplicates': 0}\nassert sleeps == [0.5, 1.0]\n",
  "hidden": "sleeps = []\ndef always(m):\n    raise TransientError('x')\nassert process_messages([{'id': 'a'}], always, sleeps.append, max_attempts=6) == {'ok': [], 'dlq': [('a', 'exhausted', 6)], 'duplicates': 0}\nassert sleeps == [0.5, 1.0, 2.0, 4.0, 4.0]\nsleeps.clear()\ndef mixed(m):\n    if m['id'] == 2:\n        raise KeyError('amount')\n    if m['id'] == 3:\n        raise TransientError('t')\nr = process_messages([{'id': 1}, {'id': 2}, {'id': 1}, {'id': 3}, {'id': 2}], mixed, sleeps.append, max_attempts=2, base=1, cap=10)\nassert r == {'ok': [1], 'dlq': [(2, 'KeyError', 1), (3, 'exhausted', 2)], 'duplicates': 2}\nassert sleeps == [1]\nsleeps.clear()\nassert process_messages([{'id': 9}], always, sleeps.append, max_attempts=1) == {'ok': [], 'dlq': [(9, 'exhausted', 1)], 'duplicates': 0} and sleeps == []\nassert process_messages([], always, sleeps.append) == {'ok': [], 'dlq': [], 'duplicates': 0}\n",
  "explanation": "Classifying exceptions is the key design decision: transient errors such as timeouts deserve a retry, while a KeyError from malformed data will fail every time and should go straight to the DLQ. The delay doubles on each failed attempt but is capped so one message cannot stall the consumer for minutes. No sleep happens after the final attempt because there is nothing left to wait for. Tracking handled ids makes redelivered duplicates harmless. Injecting sleep keeps the function fast to test and lets callers plug in jitter or a real clock."
}
```
