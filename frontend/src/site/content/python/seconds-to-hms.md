---
id: PY-058
title: Seconds To HH:MM:SS
slug: seconds-to-hms
difficulty: Easy
category: fundamentals
skill: transformation
description: Format a number of seconds as a clock duration.
topic: python-variables-data-types
concepts: divmod, f-strings, zero padding
time: O(1)
space: O(1)
minutes: 5
---

## Scenario

A job scheduler logs each batch run's duration in seconds, and the on-call report shows them as HH:MM:SS. Long backfills can run for more than a day.

## Problem

Return the duration as 'HH:MM:SS' with zero padding. Hours can exceed 24 (e.g. '27:00:00').

## Objective

Format a number of seconds as a zero-padded HH:MM:SS string whose hours can exceed 24.

## Input format

`seconds`: an int ≥ 0.

## Output format

A string.

## Constraints

- 0 ≤ seconds ≤ 10^9

## Examples

```
hms(3725)  ->  '01:02:05'
```

## Hints

- `divmod(seconds, 3600)` gives hours and the remainder.
- `f'{h:02d}'` pads to two digits.

## Why it matters

Turning raw durations into readable values is routine in run reports and SLA tracking, and divmod plus format specs is the clean way to do it.

```task
{
  "id": "seconds-to-hms",
  "title": "Seconds To HH:MM:SS",
  "type": "python",
  "instructions": "Return the duration as 'HH:MM:SS' with zero padding. Hours can exceed 24 (e.g. '27:00:00').",
  "starter": "def hms(seconds: int) -> str:\n    raise NotImplementedError\n",
  "solution": "def hms(seconds: int) -> str:\n    h, rest = divmod(seconds, 3600)\n    m, s = divmod(rest, 60)\n    return f'{h:02d}:{m:02d}:{s:02d}'\n",
  "tests": "assert hms(3725) == '01:02:05'\nassert hms(0) == '00:00:00'\n",
  "hidden": "assert hms(59) == '00:00:59'\nassert hms(3600) == '01:00:00'\nassert hms(97200) == '27:00:00'\nassert hms(360000) == '100:00:00'\n",
  "explanation": "`divmod` returns the quotient and remainder together, so two calls split seconds into hours, minutes and seconds. `:02d` pads with zeros but never truncates, so 100 hours still prints fully."
}
```
