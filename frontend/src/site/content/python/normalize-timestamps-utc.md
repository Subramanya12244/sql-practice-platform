---
id: PY-093
title: Normalise Mixed Timestamps To UTC
slug: normalize-timestamps-utc
difficulty: Medium
category: processing
skill: cleaning
description: Convert event timestamps in several formats and offsets to one UTC ISO format.
topic: python-fundamentals
concepts: datetime, timezone offsets, multiple formats
time: O(n)
space: O(n)
minutes: 20
---

## Scenario

Mobile, web and partner systems send events with different timestamp styles. The warehouse stores every event time as UTC.

## Problem

Write to_utc(values). Accept: ISO 8601 with offset ('2024-03-01T10:00:00+02:00' or trailing 'Z'), naive ISO ('2024-03-01 10:00:00', assumed UTC), and epoch seconds as int or numeric string. Return a list of strings 'YYYY-MM-DDTHH:MM:SSZ' in UTC; unparseable values or None become None.

## Objective

Parse heterogeneous timestamp formats and normalise their zone.

## Input format

list of str, int or None.

## Output format

list of str or None.

## Constraints

- Naive times are UTC
- Epoch is in seconds

## Examples

```
to_utc(['2024-03-01T10:00:00+02:00', 0, 'bad'])  ->  ['2024-03-01T08:00:00Z', '1970-01-01T00:00:00Z', None]
```

## Hints

- datetime.fromisoformat handles offsets; replace a trailing 'Z' with '+00:00' first.
- Attach timezone.utc to naive values, then astimezone(timezone.utc).

## Why it matters

Time zone bugs silently shift metrics across days. Normalising every source to UTC at ingestion is a standard rule in event pipelines.

```task
{
  "id": "normalize-timestamps-utc",
  "title": "Normalise Mixed Timestamps To UTC",
  "type": "python",
  "instructions": "Write to_utc(values). Accept: ISO 8601 with offset ('2024-03-01T10:00:00+02:00' or trailing 'Z'), naive ISO ('2024-03-01 10:00:00', assumed UTC), and epoch seconds as int or numeric string. Return a list of strings 'YYYY-MM-DDTHH:MM:SSZ' in UTC; unparseable values or None become None.",
  "starter": "def to_utc(values: list) -> list:\n    raise NotImplementedError\n",
  "solution": "from datetime import datetime, timezone\n\ndef to_utc(values: list) -> list:\n    out = []\n    for v in values:\n        dt = None\n        try:\n            if isinstance(v, bool) or v is None:\n                dt = None\n            elif isinstance(v, (int, float)) or (isinstance(v, str) and v.strip().lstrip('-').isdigit()):\n                dt = datetime.fromtimestamp(int(v), tz=timezone.utc)\n            elif isinstance(v, str):\n                s = v.strip()\n                if s.endswith('Z'):\n                    s = s[:-1] + '+00:00'\n                dt = datetime.fromisoformat(s)\n                if dt.tzinfo is None:\n                    dt = dt.replace(tzinfo=timezone.utc)\n        except (ValueError, OverflowError, OSError):\n            dt = None\n        out.append(dt.astimezone(timezone.utc).strftime('%Y-%m-%dT%H:%M:%SZ') if dt else None)\n    return out\n",
  "tests": "assert to_utc(['2024-03-01T10:00:00+02:00', 0, 'bad']) == ['2024-03-01T08:00:00Z','1970-01-01T00:00:00Z',None]\nassert to_utc(['2024-03-01 10:00:00', '2024-03-01T23:30:00Z']) == ['2024-03-01T10:00:00Z','2024-03-01T23:30:00Z']\n",
  "hidden": "assert to_utc([]) == []\nassert to_utc([None]) == [None]\nassert to_utc(['1700000000']) == ['2023-11-14T22:13:20Z']\nassert to_utc(['2024-01-01T01:00:00+05:30']) == ['2023-12-31T19:30:00Z']\nassert to_utc(['2024-13-01T00:00:00']) == [None]\nassert to_utc(['2024-03-01T20:00:00-05:00']) == ['2024-03-02T01:00:00Z']\n",
  "explanation": "Each value is routed by type: numbers and digit strings are epoch seconds, other strings go through fromisoformat. A trailing Z is rewritten so older Python versions accept it. Naive results are tagged as UTC, then everything is converted with astimezone, which applies the offset and may cross a date boundary. Parse errors are caught per value so one bad row does not fail the batch."
}
```
