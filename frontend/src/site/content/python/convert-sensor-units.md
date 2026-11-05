---
id: PY-027
title: Convert Sensor Units
slug: convert-sensor-units
difficulty: Easy
category: processing
skill: transformation
description: Convert mixed Fahrenheit and Celsius readings to Celsius.
topic: python-comprehensions
concepts: dict comprehension, unit conversion
time: O(n)
space: O(n)
minutes: 6
---

## Scenario

IoT sensors from two vendors report temperature in different units. The analytics table stores Celsius only.

## Problem

Write `to_celsius(readings)` where each reading has 'id', 'value' and 'unit' ('C' or 'F'). Return new dicts {'id', 'celsius'} with celsius rounded to 1 decimal. Skip readings with any other unit or a None value.

## Objective

Convert every valid Celsius or Fahrenheit reading to Celsius and skip readings that can't be converted.

## Input format

A list of reading dicts.

## Output format

A list of dicts.

## Constraints

- F to C: (f - 32) * 5 / 9

## Examples

```
to_celsius([{'id': 1, 'value': 212, 'unit': 'F'}, {'id': 2, 'value': 20, 'unit': 'C'}])  ->  [{'id': 1, 'celsius': 100.0}, {'id': 2, 'celsius': 20.0}]
```

## Hints

- Branch on the unit.
- Skip anything you can't convert.

## Why it matters

Unit harmonisation is a classic cleaning step when merging device or vendor feeds. Wrong units silently corrupt every downstream average.

```task
{
  "id": "convert-sensor-units",
  "title": "Convert Sensor Units",
  "type": "python",
  "instructions": "Write `to_celsius(readings)` where each reading has 'id', 'value' and 'unit' ('C' or 'F'). Return new dicts {'id', 'celsius'} with celsius rounded to 1 decimal. Skip readings with any other unit or a None value.",
  "starter": "def to_celsius(readings):\n    raise NotImplementedError\n",
  "solution": "def to_celsius(readings):\n    out = []\n    for r in readings:\n        v, u = r.get('value'), r.get('unit')\n        if v is None:\n            continue\n        if u == 'C':\n            c = v\n        elif u == 'F':\n            c = (v - 32) * 5 / 9\n        else:\n            continue\n        out.append({'id': r['id'], 'celsius': round(c, 1)})\n    return out\n",
  "tests": "assert to_celsius([{'id': 1, 'value': 212, 'unit': 'F'}, {'id': 2, 'value': 20, 'unit': 'C'}]) == [{'id': 1, 'celsius': 100.0}, {'id': 2, 'celsius': 20.0}]\n",
  "hidden": "assert to_celsius([]) == []\nassert to_celsius([{'id': 1, 'value': None, 'unit': 'C'}, {'id': 2, 'value': 5, 'unit': 'K'}]) == []\nassert to_celsius([{'id': 3, 'value': 32, 'unit': 'F'}]) == [{'id': 3, 'celsius': 0.0}]\nassert to_celsius([{'id': 4, 'value': 98.6, 'unit': 'F'}]) == [{'id': 4, 'celsius': 37.0}]\n",
  "explanation": "Each reading is branched by unit and converted with the standard formula. Unknown units and missing values are skipped so they never reach the table."
}
```
