---
id: PY-097
title: Parse Duration Strings
slug: parse-duration
difficulty: Medium
category: processing
skill: parsing
description: Turn strings like '1h30m15s' into seconds.
topic: python-regex
concepts: regex, validation, unit conversion
time: O(L)
space: O(1)
minutes: 10
---

## Scenario

A job scheduler config stores timeouts as strings like '1h30m' or '2d4h'. The runner needs them as seconds and must reject malformed values before a job is deployed.

## Problem

Parse a duration made of optional parts in order d (days), h, m, s — e.g. '2d4h', '1h30m15s', '45s' — and return the total seconds. Raise ValueError for empty strings, unknown units, repeated or out-of-order units.

## Objective

Parse a d/h/m/s duration string into total seconds, raising ValueError for empty, unknown, repeated or out-of-order units.

## Input format

A duration string.

## Output format

An int number of seconds.

## Constraints

- Units in order d, h, m, s; each at most once

## Examples

```
parse_duration('1h30m15s')  ->  5415
parse_duration('2d')  ->  172800
```

## Hints

- One anchored regex with optional groups enforces order and uniqueness: `(?:(\d+)d)?(?:(\d+)h)?(?:(\d+)m)?(?:(\d+)s)?`.
- Reject a match where every group is None.

## Why it matters

Strict parsing of config values catches mistakes at deploy time instead of during a 3 a.m. run.

```task
{
  "id": "parse-duration",
  "title": "Parse Duration Strings",
  "type": "python",
  "instructions": "Parse a duration made of optional parts in order d (days), h, m, s — e.g. '2d4h', '1h30m15s', '45s' — and return the total seconds. Raise ValueError for empty strings, unknown units, repeated or out-of-order units.",
  "starter": "def parse_duration(text: str) -> int:\n    raise NotImplementedError\n",
  "solution": "import re\n\nPATTERN = re.compile(r'(?:(\\d+)d)?(?:(\\d+)h)?(?:(\\d+)m)?(?:(\\d+)s)?')\n\n\ndef parse_duration(text: str) -> int:\n    m = PATTERN.fullmatch(text.strip())\n    if not m or not any(m.groups()):\n        raise ValueError(f'invalid duration: {text!r}')\n    d, h, mi, s = (int(g) if g else 0 for g in m.groups())\n    return ((d * 24 + h) * 60 + mi) * 60 + s\n",
  "tests": "assert parse_duration('1h30m15s') == 5415\nassert parse_duration('2d') == 172800\n",
  "hidden": "assert parse_duration('45s') == 45\nassert parse_duration('0s') == 0\nassert parse_duration(' 1d1s ') == 86401\nfor bad in ('', 'h', '5x', '1m1h', '1h1h', '10'):\n    try:\n        parse_duration(bad)\n        raise AssertionError('accepted %r' % bad)\n    except ValueError:\n        pass\n",
  "explanation": "Because every group is optional but they appear in a fixed order, fullmatch rejects out-of-order or repeated units automatically. Checking that at least one group matched rejects the empty string, which the all-optional pattern would otherwise accept."
}
```
