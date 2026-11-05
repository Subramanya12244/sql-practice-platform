---
id: PY-021
title: Average Ignoring Missing Values
slug: average-ignoring-none
difficulty: Easy
category: fundamentals
skill: cleaning
description: Average a column that contains missing values.
topic: python-etl-pipelines
concepts: filtering, None, data cleaning
time: O(n)
space: O(n)
minutes: 5
---

## Scenario

A temperature sensor feed sends one reading per minute, but dropped readings arrive as None. The operations dashboard needs the average of the readings that actually arrived, and a reading of 0 is a real value.

## Problem

Return the mean of the values that are not None, rounded to 2 decimals. Return None if there are no values.

## Objective

Compute the mean of the non-None values rounded to 2 decimals, or None when no values are present.

## Input format

`values`: numbers and None.

## Output format

A float or None.

## Constraints

- 0 counts as a real value

## Examples

```
mean_present([10, None, 20])  ->  15.0
```

## Hints

- Filter with `v is not None`, not truthiness (0 is falsy).
- Guard the empty case before dividing.

## Why it matters

Missing values are everywhere in real feeds, and treating None and 0 differently is the difference between a correct metric and a silently skewed one. It also mirrors how SQL AVG ignores NULLs, so your Python and warehouse numbers agree.

```task
{
  "id": "average-ignoring-none",
  "title": "Average Ignoring Missing Values",
  "type": "python",
  "instructions": "Return the mean of the values that are not None, rounded to 2 decimals. Return None if there are no values.",
  "starter": "def mean_present(values: list):\n    raise NotImplementedError\n",
  "solution": "def mean_present(values: list):\n    present = [v for v in values if v is not None]\n    if not present:\n        return None\n    return round(sum(present) / len(present), 2)\n",
  "tests": "assert mean_present([10, None, 20]) == 15.0\nassert mean_present([]) is None\n",
  "hidden": "assert mean_present([None, None]) is None\nassert mean_present([0, 0, None, 3]) == 1.0\nassert mean_present([1, 2]) == 1.5\nassert mean_present([1, 1, 2]) == 1.33\n",
  "explanation": "`if v` would drop zeros, which are real measurements; `is not None` removes only missing values. This mirrors how SQL's AVG ignores NULLs."
}
```
