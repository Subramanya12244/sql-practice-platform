---
id: PY-070
title: Count Log Levels
slug: log-level-counts
difficulty: Medium
category: files
skill: parsing
description: Count log entries per level, skipping malformed lines.
topic: python-regex
concepts: regex, Counter, malformed input
time: O(n)
space: O(1)
minutes: 10
---

## Scenario

An application writes log lines with a timestamp and a level such as ERROR or INFO, mixed with stack traces and garbage lines. The on-call dashboard shows how many lines of each level appeared.

## Problem

Each line looks like '2024-05-01 12:00:03 ERROR message'. Return a dict of level → count for INFO, WARNING, ERROR and DEBUG, sorted by count descending then level name. Skip lines that don't match.

## Objective

Count INFO, WARNING, ERROR and DEBUG lines matching the log format, sorted by count desc then level.

## Input format

A list of log lines.

## Output format

An ordered dict-like result.

## Constraints

- Malformed lines are ignored

## Examples

```
level_counts(['2024-05-01 12:00:03 ERROR db down', '2024-05-01 12:00:04 INFO ok'])  ->  {'ERROR': 1, 'INFO': 1}
```

## Hints

- Match `^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2} (INFO|WARNING|ERROR|DEBUG)\b`.
- Sort `Counter.items()` with a key of (-count, level).

## Why it matters

Parsing semi-structured logs with a strict pattern is a common ingestion task, and skipping non-matching lines makes the job robust to noise.

```task
{
  "id": "log-level-counts",
  "title": "Count Log Levels",
  "type": "python",
  "instructions": "Each line looks like '2024-05-01 12:00:03 ERROR message'. Return a dict of level → count for INFO, WARNING, ERROR and DEBUG, sorted by count descending then level name. Skip lines that don't match.",
  "starter": "def level_counts(lines: list) -> dict:\n    raise NotImplementedError\n",
  "solution": "import re\nfrom collections import Counter\n\nLINE = re.compile(r'^\\d{4}-\\d{2}-\\d{2} \\d{2}:\\d{2}:\\d{2} (INFO|WARNING|ERROR|DEBUG)\\b')\n\n\ndef level_counts(lines: list) -> dict:\n    counts = Counter(m.group(1) for m in map(LINE.match, lines) if m)\n    return dict(sorted(counts.items(), key=lambda kv: (-kv[1], kv[0])))\n",
  "tests": "assert level_counts(['2024-05-01 12:00:03 ERROR db down', '2024-05-01 12:00:04 INFO ok']) == {'ERROR': 1, 'INFO': 1}\n",
  "hidden": "logs = ['2024-05-01 12:00:03 INFO a', '2024-05-01 12:00:04 INFO b', 'garbage', '2024-05-01 12:00:05 WARN x', '2024-05-01 12:00:06 ERRORS y', '2024-05-01 12:00:07 DEBUG z']\nassert level_counts(logs) == {'INFO': 2, 'DEBUG': 1}\nassert list(level_counts(logs)) == ['INFO', 'DEBUG']\nassert level_counts([]) == {}\n",
  "explanation": "A precompiled regex anchored at the start rejects malformed lines; the word boundary `\\b` stops 'ERRORS' from counting as ERROR. Sorting by (−count, name) gives a deterministic order for ties."
}
```
