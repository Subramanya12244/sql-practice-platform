---
id: PY-051
title: Percentage Change
slug: percent-change
difficulty: Easy
category: fundamentals
skill: transformation
description: Compute percentage change between two periods.
topic: python-etl-pipelines
concepts: arithmetic, edge cases, rounding
time: O(1)
space: O(1)
minutes: 5
---

## Scenario

A sales report compares this month's revenue with last month's for each store. New stores had 0 revenue last month, where a percentage change has no meaning.

## Problem

Return (new − old) / old × 100 rounded to 1 decimal. If old is 0, return None (the change is undefined).

## Objective

Return the percentage change from old to new rounded to 1 decimal, or None when old is 0.

## Input format

Two numbers.

## Output format

A float or None.

## Constraints

- Negative values allowed

## Examples

```
percent_change(80, 100)  ->  25.0
percent_change(0, 5)  ->  None
```

## Hints

- Handle old == 0 before dividing.
- Multiply by 100 before rounding.

## Why it matters

Period-over-period metrics feed most business dashboards, and handling the zero baseline explicitly avoids crashes and misleading infinite growth figures.

```task
{
  "id": "percent-change",
  "title": "Percentage Change",
  "type": "python",
  "instructions": "Return (new − old) / old × 100 rounded to 1 decimal. If old is 0, return None (the change is undefined).",
  "starter": "def percent_change(old: float, new: float):\n    raise NotImplementedError\n",
  "solution": "def percent_change(old: float, new: float):\n    if old == 0:\n        return None\n    return round((new - old) / old * 100, 1)\n",
  "tests": "assert percent_change(80, 100) == 25.0\nassert percent_change(0, 5) is None\n",
  "hidden": "assert percent_change(100, 80) == -20.0\nassert percent_change(50, 50) == 0.0\nassert percent_change(3, 4) == 33.3\nassert percent_change(-10, -5) == -50.0\n",
  "explanation": "Dividing by the old value makes the change relative to the starting point. Returning None for a zero base is more honest than infinity or 0."
}
```
