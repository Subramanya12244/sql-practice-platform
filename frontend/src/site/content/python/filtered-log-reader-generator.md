---
id: PY-080
title: Generator That Streams Filtered Log Records
slug: filtered-log-reader-generator
difficulty: Medium
category: advanced
skill: streaming
description: Lazily read a log file and yield parsed records that match a level filter.
topic: python-file-handling
concepts: generators, yield, lazy file reading, early stop
time: O(n)
space: O(1)
minutes: 15
---

## Scenario

Application logs are gigabytes per day. Support needs only WARN and ERROR events as dicts, and often stops after the first few.

## Problem

Write read_events(path, levels). It is a generator. Each line has the form 'TIMESTAMP LEVEL service: message'. Yield {'ts','level','service','message'} for lines whose LEVEL is in levels, in file order. Skip lines that do not split into this shape. The function must be lazy: it should read only as much of the file as the consumer requests.

## Objective

Build a lazy, filtering parser with a generator.

## Input format

path, set of levels.

## Output format

generator of dicts.

## Constraints

- Use yield
- Message may contain ':'

## Examples

```
'2024-01-01T00:00:00Z ERROR billing: card declined: 51'  ->  {'ts':'2024-01-01T00:00:00Z','level':'ERROR','service':'billing','message':'card declined: 51'}
```

## Hints

- line.split(' ', 2) gives ts, level and the rest.
- rest.partition(': ') splits service from message on the first separator.

## Why it matters

Generators let pipelines process files bigger than memory and stop early. Lazy parsing is the core of streaming-style Python ETL.

```task
{
  "id": "filtered-log-reader-generator",
  "title": "Generator That Streams Filtered Log Records",
  "type": "python",
  "instructions": "Write read_events(path, levels). It is a generator. Each line has the form 'TIMESTAMP LEVEL service: message'. Yield {'ts','level','service','message'} for lines whose LEVEL is in levels, in file order. Skip lines that do not split into this shape. The function must be lazy: it should read only as much of the file as the consumer requests.",
  "starter": "def read_events(path: str, levels: set):\n    raise NotImplementedError\n",
  "solution": "def read_events(path: str, levels: set):\n    with open(path) as f:\n        for line in f:\n            parts = line.rstrip('\\n').split(' ', 2)\n            if len(parts) != 3:\n                continue\n            ts, level, rest = parts\n            service, sep, msg = rest.partition(': ')\n            if not sep or not service:\n                continue\n            if level in levels:\n                yield {'ts': ts, 'level': level, 'service': service, 'message': msg}\n",
  "tests": "open('app.log','w').write('2024-01-01T00:00:00Z ERROR billing: card declined: 51\\n2024-01-01T00:00:01Z INFO web: ok\\n')\nassert list(read_events('app.log', {'ERROR','WARN'})) == [{'ts':'2024-01-01T00:00:00Z','level':'ERROR','service':'billing','message':'card declined: 51'}]\nimport types\nassert isinstance(read_events('app.log', {'INFO'}), types.GeneratorType)\n",
  "hidden": "open('app.log','w').write('')\nassert list(read_events('app.log', {'ERROR'})) == []\nopen('app.log','w').write('garbage\\nt WARN noservice\\nt WARN api: slow\\n\\n')\nassert list(read_events('app.log', {'WARN'})) == [{'ts':'t','level':'WARN','service':'api','message':'slow'}]\nopen('app.log','w').write(''.join(f't ERROR s: m{i}\\n' for i in range(100000)))\ng=read_events('app.log', {'ERROR'})\nassert next(g)['message']=='m0' and next(g)['message']=='m1'\ng.close()\nassert sum(1 for _ in read_events('app.log', {'INFO'})) == 0\n",
  "explanation": "Because the function contains yield, calling it returns a generator and no file work happens until iteration. Iterating the file object reads one line at a time, so the consumer can stop after a few matches. Splitting with maxsplit and partition keeps colons inside the message intact. The with block closes the file when the generator finishes or is closed."
}
```
