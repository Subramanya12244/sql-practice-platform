---
id: PY-075
title: Endpoint Latency Stats From Access Logs
slug: access-log-endpoint-stats
difficulty: Medium
category: files
skill: parsing
description: Parse web access log lines and report request count, error rate and max latency per endpoint.
topic: python-regex
concepts: regex groups, log parsing, per-key stats
time: O(n)
space: O(e)
minutes: 20
---

## Scenario

The API team wants a quick health report per endpoint from the gateway log before the observability stack is ready.

## Problem

Write endpoint_stats(path). Each valid line looks like '2024-05-01T10:00:00Z GET /api/orders?id=3 200 123ms'. Strip the query string from the path. Return ({endpoint: {'count', 'errors', 'max_ms'}}, malformed_count) where errors counts status >= 500 and endpoint is 'METHOD /path'. Lines that do not match are malformed; blank lines are ignored.

## Objective

Parse semi-structured log lines with a regex and aggregate per key.

## Input format

File path.

## Output format

tuple (dict, int).

## Constraints

- Process line by line

## Examples

```
'2024-05-01T10:00:00Z GET /api/orders?id=3 200 123ms'  ->  {'GET /api/orders': {'count':1,'errors':0,'max_ms':123}}
```

## Hints

- One regex with groups for method, path, status and ms.
- path.split('?')[0] drops the query string.

## Why it matters

Log parsing into metrics is a common early ETL task for app teams. Counting malformed lines keeps you honest about data you dropped.

```task
{
  "id": "access-log-endpoint-stats",
  "title": "Endpoint Latency Stats From Access Logs",
  "type": "python",
  "instructions": "Write endpoint_stats(path). Each valid line looks like '2024-05-01T10:00:00Z GET /api/orders?id=3 200 123ms'. Strip the query string from the path. Return ({endpoint: {'count', 'errors', 'max_ms'}}, malformed_count) where errors counts status >= 500 and endpoint is 'METHOD /path'. Lines that do not match are malformed; blank lines are ignored.",
  "starter": "def endpoint_stats(path: str) -> tuple:\n    raise NotImplementedError\n",
  "solution": "import re\n\nLINE = re.compile(r'^\\S+ ([A-Z]+) (\\S+) (\\d{3}) (\\d+)ms$')\n\ndef endpoint_stats(path: str) -> tuple:\n    stats, bad = {}, 0\n    with open(path) as f:\n        for line in f:\n            line = line.strip()\n            if not line:\n                continue\n            m = LINE.match(line)\n            if not m:\n                bad += 1\n                continue\n            method, p, status, ms = m.groups()\n            key = f\"{method} {p.split('?')[0]}\"\n            s = stats.setdefault(key, {'count': 0, 'errors': 0, 'max_ms': 0})\n            s['count'] += 1\n            s['errors'] += int(status) >= 500\n            s['max_ms'] = max(s['max_ms'], int(ms))\n    return stats, bad\n",
  "tests": "open('a.log','w').write('2024-05-01T10:00:00Z GET /api/orders?id=3 200 123ms\\n')\nassert endpoint_stats('a.log') == ({'GET /api/orders':{'count':1,'errors':0,'max_ms':123}}, 0)\nopen('a.log','w').write('t GET /x 503 10ms\\nt GET /x 200 40ms\\ngarbage\\n')\nassert endpoint_stats('a.log') == ({'GET /x':{'count':2,'errors':1,'max_ms':40}}, 1)\n",
  "hidden": "open('a.log','w').write('')\nassert endpoint_stats('a.log') == ({}, 0)\nopen('a.log','w').write('\\n\\nt POST /x 201 5ms\\nt GET /x 404 7ms\\n')\nassert endpoint_stats('a.log') == ({'POST /x':{'count':1,'errors':0,'max_ms':5},'GET /x':{'count':1,'errors':0,'max_ms':7}}, 0)\nopen('a.log','w').write('t GET /x 200 abcms\\nt GET /x 2000 1ms\\n')\nassert endpoint_stats('a.log') == ({}, 2)\nopen('a.log','w').write(''.join(f't GET /p?{i} {500 if i%10==0 else 200} {i}ms\\n' for i in range(3000)))\nassert endpoint_stats('a.log')[0]['GET /p'] == {'count':3000,'errors':300,'max_ms':2999}\n",
  "explanation": "An anchored regex both validates and extracts fields, so any line that does not fit exactly is counted as malformed. Removing the query string groups requests by route instead of by unique URL. Stats per endpoint are updated incrementally as the file streams, keeping memory proportional to the number of endpoints."
}
```
