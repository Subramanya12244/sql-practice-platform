---
id: PY-148
title: Structured JSON Logging For Pipeline Runs
slug: structured-run-logging
difficulty: Hard
category: advanced
skill: reliability
description: Run a transform over records while emitting structured JSON log lines with run and record context via the logging module.
topic: python-logging
concepts: logging handlers, extra fields, levels, handler cleanup, JSON lines
time: O(records)
space: O(records) for lines
minutes: 30
---

## Scenario

Support engineers search pipeline logs by run id and record id when a customer asks why their order is missing. Free-text print statements make that impossible, so runs must emit structured JSON logs.

## Problem

Write `run_with_logging(records, transform, run_id, level=logging.INFO)` returning `(results, lines)`. Use `logging.getLogger('etl.' + run_id)` with a custom Handler (set to `level`) that appends to `lines` one JSON string per record: `json.dumps({'level': levelname, 'msg': message, 'run_id': run_id, 'record_id': id_or_None}, sort_keys=True)`. Pass record ids through `extra`. Log INFO 'start', then for each record DEBUG 'processing', then INFO 'ok' on success (collect the transform result) or ERROR 'failed: <ExceptionClassName>' on failure, and finally INFO 'done ok=<n> failed=<m>'. Records are dicts with `id`. The logger must not propagate to the root logger, and the handler must be removed afterwards even if something raises, so repeated runs with the same run_id never duplicate lines.

## Objective

Use the logging module properly: handlers, levels, contextual fields and cleanup.

## Input format

A list of record dicts, a transform callable, a run id and a level.

## Output format

(list of results, list of JSON strings).

## Constraints

- Use the logging module, not print
- No duplicate handlers across runs
- Exceptions from transform are logged, not raised

## Examples

```
res, lines = run_with_logging([{'id': 1}], lambda r: r['id'] * 10, 'r1')
res == [10]; json.loads(lines[1]) == {'level': 'INFO', 'msg': 'ok', 'record_id': 1, 'run_id': 'r1'}
```

## Hints

- Subclass logging.Handler and implement emit(record) using record.getMessage() and getattr(record, 'record_id', None).
- Set the logger level to DEBUG and the handler level to `level` so filtering is the handler's job.
- Wrap the run in try/finally and call logger.removeHandler(handler).

## Why it matters

Structured logs are what make pipeline incidents debuggable at scale, because they can be filtered by run and record. Handler leaks and duplicate log lines are classic bugs in long-lived workers.

```task
{
  "id": "structured-run-logging",
  "title": "Structured JSON Logging For Pipeline Runs",
  "type": "python",
  "instructions": "Write `run_with_logging(records, transform, run_id, level=logging.INFO)` returning `(results, lines)`. Use `logging.getLogger('etl.' + run_id)` with a custom Handler (set to `level`) that appends to `lines` one JSON string per record: `json.dumps({'level': levelname, 'msg': message, 'run_id': run_id, 'record_id': id_or_None}, sort_keys=True)`. Pass record ids through `extra`. Log INFO 'start', then for each record DEBUG 'processing', then INFO 'ok' on success (collect the transform result) or ERROR 'failed: <ExceptionClassName>' on failure, and finally INFO 'done ok=<n> failed=<m>'. Records are dicts with `id`. The logger must not propagate to the root logger, and the handler must be removed afterwards even if something raises, so repeated runs with the same run_id never duplicate lines.",
  "starter": "import logging\n\n\ndef run_with_logging(records, transform, run_id: str, level=logging.INFO):\n    raise NotImplementedError\n",
  "solution": "import json\nimport logging\n\n\nclass _ListHandler(logging.Handler):\n    def __init__(self, sink, run_id, level):\n        super().__init__(level)\n        self.sink, self.run_id = sink, run_id\n\n    def emit(self, record):\n        self.sink.append(json.dumps({\"level\": record.levelname, \"msg\": record.getMessage(), \"run_id\": self.run_id,\n                                     \"record_id\": getattr(record, \"record_id\", None)}, sort_keys=True))\n\n\ndef run_with_logging(records, transform, run_id: str, level=logging.INFO):\n    logger = logging.getLogger(\"etl.\" + run_id)\n    logger.setLevel(logging.DEBUG)\n    logger.propagate = False\n    lines, results = [], []\n    handler = _ListHandler(lines, run_id, level)\n    logger.addHandler(handler)\n    try:\n        logger.info(\"start\")\n        ok = failed = 0\n        for rec in records:\n            ctx = {\"record_id\": rec.get(\"id\")}\n            logger.debug(\"processing\", extra=ctx)\n            try:\n                results.append(transform(rec))\n            except Exception as exc:\n                failed += 1\n                logger.error(\"failed: %s\", type(exc).__name__, extra=ctx)\n            else:\n                ok += 1\n                logger.info(\"ok\", extra=ctx)\n        logger.info(\"done ok=%d failed=%d\", ok, failed)\n    finally:\n        logger.removeHandler(handler)\n    return results, lines\n",
  "tests": "import json\nres, lines = run_with_logging([{'id': 1}], lambda r: r['id'] * 10, 'r1')\nassert res == [10]\nassert [json.loads(l)['msg'] for l in lines] == ['start', 'ok', 'done ok=1 failed=0']\nassert json.loads(lines[1]) == {'level': 'INFO', 'msg': 'ok', 'record_id': 1, 'run_id': 'r1'}\n",
  "hidden": "import json, logging\ndef tf(r):\n    if r['amount'] < 0:\n        raise ValueError('negative')\n    return r['amount']\nrecs = [{'id': 'o1', 'amount': 5}, {'id': 'o2', 'amount': -1}, {'id': 'o3'}]\nres, lines = run_with_logging(recs, tf, 'nightly')\nassert res == [5]\nparsed = [json.loads(l) for l in lines]\nassert [(p['level'], p['msg'], p['record_id']) for p in parsed] == [('INFO', 'start', None), ('INFO', 'ok', 'o1'), ('ERROR', 'failed: ValueError', 'o2'), ('ERROR', 'failed: KeyError', 'o3'), ('INFO', 'done ok=1 failed=2', None)]\nassert lines[0] == json.dumps({'level': 'INFO', 'msg': 'start', 'record_id': None, 'run_id': 'nightly'}, sort_keys=True)\nres2, lines2 = run_with_logging(recs, tf, 'nightly')\nassert lines2 == lines and logging.getLogger('etl.nightly').handlers == []\n_, dbg = run_with_logging([{'id': 7, 'amount': 1}], tf, 'dbg', level=logging.DEBUG)\nassert [json.loads(l)['msg'] for l in dbg] == ['start', 'processing', 'ok', 'done ok=1 failed=0']\n_, errs = run_with_logging(recs, tf, 'quiet', level=logging.ERROR)\nassert len(errs) == 2\nassert logging.getLogger('etl.quiet').propagate is False\n_, empty = run_with_logging([], tf, 'e')\nassert [json.loads(l)['msg'] for l in empty] == ['start', 'done ok=0 failed=0']\n",
  "explanation": "A custom Handler decides the output format, so every line is machine-readable JSON with the same keys, which log search tools can index. Contextual fields travel on the LogRecord through extra, keeping call sites clean while still tagging each line with the record id. Setting the logger to DEBUG and filtering at the handler level makes verbosity a per-run choice. Disabling propagation stops duplicate output through the root logger, and removing the handler in finally prevents handler leaks that would duplicate lines on every later run. Logging failures instead of raising keeps one bad record from stopping the run while still leaving a precise trail."
}
```
