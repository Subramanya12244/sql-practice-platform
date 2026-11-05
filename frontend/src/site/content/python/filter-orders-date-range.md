---
id: PY-037
title: Filter Orders by Date Range
slug: filter-orders-date-range
difficulty: Easy
category: processing
skill: cleaning
description: Keep only orders within an inclusive date range.
topic: python-comprehensions
concepts: list comprehension, string date comparison
time: O(n)
space: O(n)
minutes: 5
---

## Scenario

A monthly report should include only orders placed between two dates, and orders without a date must be excluded.

## Problem

Write `orders_between(orders, start, end)` where dates are 'YYYY-MM-DD' strings. Return orders whose 'order_date' is between start and end inclusive, in input order.

## Objective

Keep only the orders whose order_date falls within the inclusive start and end dates.

## Input format

A list of dicts, start and end date strings.

## Output format

A filtered list.

## Constraints

- Missing order_date is excluded

## Examples

```
orders_between([{'id': 1, 'order_date': '2024-01-31'}, {'id': 2, 'order_date': '2024-02-01'}], '2024-01-01', '2024-01-31')  ->  [{'id': 1, ...}]
```

## Hints

- ISO dates sort the same as text.
- Use a chained comparison start <= d <= end.

## Why it matters

Date-range filters define every reporting window and backfill. ISO date strings compare correctly as text, which is a handy trick.

```task
{
  "id": "filter-orders-date-range",
  "title": "Filter Orders by Date Range",
  "type": "python",
  "instructions": "Write `orders_between(orders, start, end)` where dates are 'YYYY-MM-DD' strings. Return orders whose 'order_date' is between start and end inclusive, in input order.",
  "starter": "def orders_between(orders, start, end):\n    raise NotImplementedError\n",
  "solution": "def orders_between(orders, start, end):\n    return [o for o in orders if o.get('order_date') and start <= o['order_date'] <= end]\n",
  "tests": "r = orders_between([{'id': 1, 'order_date': '2024-01-31'}, {'id': 2, 'order_date': '2024-02-01'}], '2024-01-01', '2024-01-31')\nassert [o['id'] for o in r] == [1]\n",
  "hidden": "assert orders_between([], '2024-01-01', '2024-12-31') == []\nassert orders_between([{'id': 1}, {'id': 2, 'order_date': None}], '2000-01-01', '2099-01-01') == []\nr = orders_between([{'id': 1, 'order_date': '2024-01-01'}], '2024-01-01', '2024-01-01')\nassert len(r) == 1\nassert orders_between([{'id': 1, 'order_date': '2024-05-01'}], '2024-06-01', '2024-01-01') == []\n",
  "explanation": "Zero-padded ISO dates compare lexically in date order, so plain string comparison works. Orders without a date fail the truthiness check and are dropped."
}
```
