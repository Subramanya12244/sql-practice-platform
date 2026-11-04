---
title: Bucket Events by Week
slug: bucket-events-by-week
difficulty: Medium
description: Parse mixed-format timestamps and count events per ISO week start date.
topic: python-functions
minutes: 20
---

## Problem

Write `def bucket_by_week(timestamps: list) -> dict` that parses each string with either format
`%Y-%m-%d %H:%M:%S` or `%d/%m/%Y`, and returns `{week_start_iso: count}` where `week_start_iso` is the
Monday of that week as `YYYY-MM-DD`. Unparseable values and `None` are skipped. Keys are in ascending order.

## Examples

```
bucket_by_week(["2024-01-03 10:00:00", "07/01/2024", "2024-01-08 00:00:00", "garbage"])
  ->  {"2024-01-01": 2, "2024-01-08": 1}
```

## Hints

- Try each format in turn with `datetime.strptime`, catching `ValueError`.
- Monday = `d - timedelta(days=d.weekday())`.

```task
{
  "id": "bucket-events-by-week",
  "title": "Bucket Events by Week",
  "type": "python",
  "instructions": "Write `def bucket_by_week(timestamps: list) -> dict` that parses each string with either format\n`%Y-%m-%d %H:%M:%S` or `%d/%m/%Y`, and returns `{week_start_iso: count}` where `week_start_iso` is the\nMonday of that week as `YYYY-MM-DD`. Unparseable values and `None` are skipped. Keys are in ascending order.",
  "starter": "def bucket_by_week(timestamps: list) -> dict:\n    raise NotImplementedError\n",
  "solution": "from datetime import datetime, timedelta\n\nFORMATS = (\"%Y-%m-%d %H:%M:%S\", \"%d/%m/%Y\")\n\ndef _parse(s):\n    for f in FORMATS:\n        try:\n            return datetime.strptime(s, f)\n        except (ValueError, TypeError):\n            pass\n    return None\n\ndef bucket_by_week(timestamps: list) -> dict:\n    counts = {}\n    for s in timestamps:\n        dt = _parse(s)\n        if dt is None:\n            continue\n        wk = (dt.date() - timedelta(days=dt.weekday())).isoformat()\n        counts[wk] = counts.get(wk, 0) + 1\n    return dict(sorted(counts.items()))\n",
  "tests": "r = bucket_by_week([\"2024-01-03 10:00:00\", \"07/01/2024\", \"2024-01-08 00:00:00\", \"garbage\"])\nassert r == {\"2024-01-01\": 2, \"2024-01-08\": 1}\nassert list(r) == [\"2024-01-01\", \"2024-01-08\"]\nassert bucket_by_week([]) == {}\nassert bucket_by_week([None, \"31/02/2024\"]) == {}\nassert list(bucket_by_week([\"2024-03-10 00:00:00\", \"2024-01-01 00:00:00\"])) == [\"2024-01-01\", \"2024-03-04\"]\n"
}
```
