---
title: Retry mechanisms
slug: etl-retries
category: etl
difficulty: Intermediate
description: Retry transient ETL failures safely - exponential backoff with jitter, max attempts, Retry-After, retryable error classes and why retries need idempotency.
prerequisites: [etl-error-handling]
related: [etl-idempotency, airflow-retries, python-api-integration, python-exceptions]
questions: []
patterns: []
guides: []
projects: [rest-api-to-postgres, airflow-etl-pipeline]
minutes: 8
version: 1
---

## Introduction

Many failures fix themselves: the API was busy, a lock timed out, the network blinked. A retry policy turns these into non-events, while a bad policy turns them into outages.

## Definition

A retry mechanism re-executes a failed operation, only for **retryable** errors, waiting between attempts according to a **backoff** strategy, up to a **maximum** number of attempts or total time, then failing or dead-lettering.

## Why it matters

- Most pipeline failures are transient.
- Immediate, unlimited retries hammer a struggling service (retry storm).
- Retries re-run side effects, so the operation must be idempotent.

## How it works

- **Retryable errors:** timeouts, connection resets, HTTP 429/502/503/504, deadlocks, serialization failures (`40001`, `40P01` in PostgreSQL).
- **Not retryable:** 400, 401, 403, 404, constraint violations, parse errors.
- **Exponential backoff:** wait `base * 2^attempt`, capped at a maximum.
- **Jitter:** randomise the wait (e.g. full jitter `uniform(0, backoff)`) so many clients do not retry in sync.
- **Retry-After:** honour the server's hint when provided.
- **Budget:** max attempts or max elapsed time, then give up.

Retries exist at several levels: inside the client call, at the task level (orchestrator), and at the pipeline level (rerun a day).

## Syntax and configuration

Task-level retries in Airflow:

```python-syntax
PythonOperator(
    task_id="extract_orders",
    python_callable=extract_orders,
    retries=5,
    retry_delay=timedelta(seconds=30),
    retry_exponential_backoff=True,
    max_retry_delay=timedelta(minutes=10),
)
```

Retrying a PostgreSQL transaction on serialization failure:

```python-syntax
for attempt in range(5):
    try:
        with conn.transaction():
            run_load(conn)
        break
    except psycopg.errors.SerializationFailure:
        time.sleep(min(30, 0.5 * 2 ** attempt) * random.random())
```

## Examples

Retry-safe SQL: an upsert can be executed any number of times with the same final state, which is what makes retrying it safe.

```sql
CREATE TEMP TABLE daily_freight (order_date DATE PRIMARY KEY, freight NUMERIC);

INSERT INTO daily_freight
SELECT order_date, SUM(freight) FROM orders WHERE order_date = DATE '1997-05-01' GROUP BY order_date
ON CONFLICT (order_date) DO UPDATE SET freight = EXCLUDED.freight;

-- "retry" the same statement
INSERT INTO daily_freight
SELECT order_date, SUM(freight) FROM orders WHERE order_date = DATE '1997-05-01' GROUP BY order_date
ON CONFLICT (order_date) DO UPDATE SET freight = EXCLUDED.freight;

SELECT order_date, freight, (SELECT COUNT(*) FROM daily_freight) AS rows FROM daily_freight
```

## Architecture

```mermaid
flowchart TD
  call["Call operation"] --> ok{"Success?"}
  ok -->|yes| done["Continue"]
  ok -->|no| kind{"Retryable?"}
  kind -->|no| dlq["Fail or dead-letter"]
  kind -->|yes| budget{"Attempts left?"}
  budget -->|no| dlq
  budget -->|yes| wait["Sleep backoff with jitter"]
  wait --> call
```

Only retryable errors loop, each loop waits longer, and the budget guarantees the loop ends.

## Practical example

A reusable retry decorator with exponential backoff, full jitter, a retryable-error whitelist and an injectable sleep (so this demo runs instantly).

```python
import functools
import random

class TransientError(Exception):
    pass

class PermanentError(Exception):
    pass

def retry(max_attempts=5, base=0.5, cap=30.0, retry_on=(TransientError, TimeoutError), sleep=None, log=print):
    sleep = sleep or (lambda s: None)
    def deco(fn):
        @functools.wraps(fn)
        def wrapper(*args, **kwargs):
            for attempt in range(1, max_attempts + 1):
                try:
                    return fn(*args, **kwargs)
                except retry_on as e:
                    if attempt == max_attempts:
                        raise
                    delay = random.uniform(0, min(cap, base * 2 ** (attempt - 1)))  # full jitter
                    log(f"attempt {attempt} failed ({e}); retrying in {delay:.2f}s")
                    sleep(delay)
        return wrapper
    return deco

random.seed(7)
waits = []
calls = {"n": 0}

@retry(sleep=waits.append)
def flaky_extract():
    calls["n"] += 1
    if calls["n"] < 3:
        raise TransientError("HTTP 503")
    return [{"order_id": 1}]

print(flaky_extract(), "after", calls["n"], "calls")

@retry(sleep=waits.append)
def bad_request():
    raise PermanentError("HTTP 400: invalid parameter")

try:
    bad_request()
except PermanentError as e:
    print("not retried:", e)
assert calls["n"] == 3 and len(waits) == 2
```

## Exercises

1. Why add jitter to exponential backoff?
<details><summary>Answer</summary>Without it, many clients that failed together retry together, creating synchronized load spikes (thundering herd).</details>

2. A task inserts rows with plain `INSERT` and has `retries=3`. What can go wrong?
<details><summary>Answer</summary>If it fails after a partial commit, the retry inserts the rows again: duplicates. Make it idempotent (upsert, overwrite partition) first.</details>

3. Should a 401 Unauthorized be retried?
<details><summary>Answer</summary>No. Credentials will not fix themselves; fail fast and alert (an exception is refreshing an expired token once).</details>

## Common mistakes

- Retrying every exception, including bugs and bad data.
- No cap or budget, so jobs retry for hours.
- Fixed short delays that overload the dependency.
- Retries at three layers multiplying (5 x 5 x 5 = 125 attempts).
- Retrying non-idempotent writes.

## Performance and best practices

- Whitelist retryable errors explicitly.
- Exponential backoff, capped, with full jitter.
- Honour `Retry-After` for 429/503.
- Retry at one layer where possible; keep others small.
- Log each attempt with the reason; alert when retries succeed often (it hides degradation).
- Combine with circuit breakers for chronically failing dependencies.

## Interview questions

### What is exponential backoff with jitter?

Delays that grow exponentially per attempt (`base * 2^n`, capped), randomised so clients spread out their retries.

### Which errors should be retried?

Transient ones: timeouts, connection errors, 429 and 5xx responses, deadlocks and serialization failures. Not client errors, validation failures or bugs.

### Why must retried operations be idempotent?

A failure can happen after the side effect succeeded (e.g. commit done, response lost), so the retry repeats it; idempotency makes the repeat harmless.

### How many retries would you configure?

Enough to outlast typical transient blips within the SLA, e.g. 3–5 attempts with backoff up to a few minutes, plus alerting when the budget is exhausted.

## Quick revision

- Retry only transient errors.
- Exponential backoff, capped, with jitter.
- Respect `Retry-After`.
- Set a max attempts or time budget.
- Retried operations must be idempotent.
- Avoid stacking retries across layers.
