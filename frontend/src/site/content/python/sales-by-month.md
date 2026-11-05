---
id: PY-101
title: Sales Totals By Month
slug: sales-by-month
difficulty: Medium
category: processing
skill: aggregation
description: Aggregate dated sales into monthly totals.
topic: python-etl-pipelines
concepts: date parsing, grouping, defaultdict
time: O(n + m log m)
space: O(m)
minutes: 10
---

## Scenario

A retail system exports daily sales as (date, amount) pairs. Finance wants monthly totals in chronological order, and a malformed date should stop the job rather than be silently dropped.

## Problem

`sales` holds (date_string 'YYYY-MM-DD', amount). Return a dict of 'YYYY-MM' → total amount (2 dp), in chronological order. Invalid dates raise ValueError.

## Objective

Return chronologically ordered 'YYYY-MM' totals rounded to 2 dp, raising ValueError for invalid dates.

## Input format

A list of (str, number).

## Output format

A dict ordered by month.

## Constraints

- Use datetime to validate dates

## Examples

```
monthly_totals([('2024-01-15', 10), ('2024-01-20', 5.5), ('2023-12-31', 1)])  ->  {'2023-12': 1.0, '2024-01': 15.5}
```

## Hints

- `datetime.strptime(s, '%Y-%m-%d')` validates and parses.
- Group with a defaultdict(float), then sort the keys.

## Why it matters

Rolling daily facts up to months is one of the most common reporting transformations, and failing on bad dates protects financial totals from silent gaps.

```task
{
  "id": "sales-by-month",
  "title": "Sales Totals By Month",
  "type": "python",
  "instructions": "`sales` holds (date_string 'YYYY-MM-DD', amount). Return a dict of 'YYYY-MM' → total amount (2 dp), in chronological order. Invalid dates raise ValueError.",
  "starter": "def monthly_totals(sales: list) -> dict:\n    raise NotImplementedError\n",
  "solution": "from collections import defaultdict\nfrom datetime import datetime\n\n\ndef monthly_totals(sales: list) -> dict:\n    totals = defaultdict(float)\n    for day, amount in sales:\n        d = datetime.strptime(day, '%Y-%m-%d')\n        totals[f'{d.year:04d}-{d.month:02d}'] += amount\n    return {k: round(totals[k], 2) for k in sorted(totals)}\n",
  "tests": "assert monthly_totals([('2024-01-15', 10), ('2024-01-20', 5.5), ('2023-12-31', 1)]) == {'2023-12': 1.0, '2024-01': 15.5}\n",
  "hidden": "assert monthly_totals([]) == {}\nassert list(monthly_totals([('2024-10-01', 1), ('2024-02-01', 1)])) == ['2024-02', '2024-10']\nassert monthly_totals([('2024-03-01', 0.1), ('2024-03-02', 0.2)]) == {'2024-03': 0.3}\ntry:\n    monthly_totals([('2024-02-30', 1)])\n    raise AssertionError('expected ValueError')\nexcept ValueError:\n    pass\n",
  "explanation": "Parsing with strptime both validates (30 February fails) and normalises the key. Zero-padded 'YYYY-MM' strings sort chronologically, and rounding at the end hides float artefacts like 0.30000000000000004."
}
```
