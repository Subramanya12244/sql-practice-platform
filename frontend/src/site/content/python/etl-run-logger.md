---
id: PY-085
title: Log ETL Step Metrics With The logging Module
slug: etl-run-logger
difficulty: Medium
category: etl
skill: orchestration
description: Run extract, transform and load steps, logging row counts and failures through logging.
topic: python-logging
concepts: logging.Logger, handlers, step timing via injected clock
time: O(s)
space: O(1)
minutes: 20
---

## Scenario

Ops needs a consistent log line per pipeline step so alerts can be built on it. Steps are plain functions passed in a list.

## Problem

Write run_pipeline(steps, logger, clock). steps is a list of (name, func); each func takes the previous step's output (the first gets None) and returns a list. For each step log at INFO 'step=<name> rows=<len> secs=<elapsed>' with elapsed from clock() rounded to 2. If a step raises, log at ERROR 'step=<name> failed: <ExcType>' and return None without running later steps. Otherwise return the last output.

## Objective

Instrument a simple pipeline with structured logs.

## Input format

list of tuples, logging.Logger, clock callable.

## Output format

final list or None.

## Constraints

- Use logger.info / logger.error
- clock is injected for determinism

## Examples

```
steps [('extract', lambda _: [1,2,3]), ('load', lambda rows: rows)]  ->  logs 'step=extract rows=3 secs=1.0', 'step=load rows=3 secs=1.0'
```

## Hints

- Call clock() before and after each step.
- Catch Exception, log, and return early.

## Why it matters

Structured step logs are the first layer of pipeline observability. Using logging instead of print lets ops route, filter and alert on them.

```task
{
  "id": "etl-run-logger",
  "title": "Log ETL Step Metrics With The logging Module",
  "type": "python",
  "instructions": "Write run_pipeline(steps, logger, clock). steps is a list of (name, func); each func takes the previous step's output (the first gets None) and returns a list. For each step log at INFO 'step=<name> rows=<len> secs=<elapsed>' with elapsed from clock() rounded to 2. If a step raises, log at ERROR 'step=<name> failed: <ExcType>' and return None without running later steps. Otherwise return the last output.",
  "starter": "def run_pipeline(steps: list, logger, clock):\n    raise NotImplementedError\n",
  "solution": "def run_pipeline(steps: list, logger, clock):\n    data = None\n    for name, func in steps:\n        start = clock()\n        try:\n            data = func(data)\n        except Exception as e:\n            logger.error('step=%s failed: %s', name, type(e).__name__)\n            return None\n        logger.info('step=%s rows=%d secs=%s', name, len(data), round(clock() - start, 2))\n    return data\n",
  "tests": "import logging, itertools\nclass Cap(logging.Handler):\n    def __init__(self):\n        super().__init__(); self.msgs=[]\n    def emit(self, rec):\n        self.msgs.append((rec.levelname, rec.getMessage()))\nlog=logging.getLogger('t1'); log.setLevel(logging.INFO); cap=Cap(); log.addHandler(cap)\nticks=itertools.count(0.0)\nout=run_pipeline([('extract', lambda _: [1,2,3]), ('load', lambda rows: rows)], log, lambda: next(ticks))\nassert out == [1,2,3]\nassert cap.msgs == [('INFO','step=extract rows=3 secs=1.0'),('INFO','step=load rows=3 secs=1.0')]\n",
  "hidden": "import logging, itertools\nclass Cap(logging.Handler):\n    def __init__(self):\n        super().__init__(); self.msgs=[]\n    def emit(self, rec):\n        self.msgs.append((rec.levelname, rec.getMessage()))\nlog=logging.getLogger('t2'); log.setLevel(logging.INFO); cap=Cap(); log.addHandler(cap)\nticks=itertools.count(0.0, 0.5)\nran=[]\nout=run_pipeline([('a', lambda _: []), ('b', lambda d: 1/0), ('c', lambda d: ran.append(1) or [])], log, lambda: next(ticks))\nassert out is None and ran == []\nassert cap.msgs == [('INFO','step=a rows=0 secs=0.5'),('ERROR','step=b failed: ZeroDivisionError')]\ncap.msgs.clear()\nassert run_pipeline([], log, lambda: 0) is None and cap.msgs == []\n",
  "explanation": "The clock is read around each step, and injecting it keeps timings deterministic in tests. Lazy %-style arguments let logging format messages only when they are emitted. A failing step is logged at ERROR with its exception type and stops the pipeline, since later steps would run on bad input. Each successful step passes its output forward."
}
```
