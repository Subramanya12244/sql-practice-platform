---
id: PY-048
title: Order Size Tier
slug: order-size-tier
difficulty: Easy
category: fundamentals
skill: transformation
description: Label orders as small, medium or large by amount.
topic: python-conditionals
concepts: if/elif/else, comparisons
time: O(1)
space: O(1)
minutes: 5
---

## Scenario

The finance dashboard groups orders into size tiers, and the tier must be computed in the pipeline so every report agrees.

## Problem

Write `order_tier(amount)` returning 'small' for amounts below 50, 'medium' for 50 up to but not including 500, and 'large' for 500 or more. Negative amounts or None return 'invalid'.

## Objective

Return the correct size tier for any order amount, treating None and negatives as invalid.

## Input format

A number or None.

## Output format

One of 'small', 'medium', 'large', 'invalid'.

## Constraints

- Boundaries: 50 is medium, 500 is large

## Examples

```
order_tier(20)  ->  'small'
order_tier(50)  ->  'medium'
order_tier(999.9)  ->  'large'
```

## Hints

- Handle None and negatives first.
- Check thresholds from smallest to largest with elif.

## Why it matters

Derived columns like tiers and buckets are everywhere in reporting tables. Getting the boundaries right is what keeps dashboards consistent.

```task
{
  "id": "order-size-tier",
  "title": "Order Size Tier",
  "type": "python",
  "instructions": "Write `order_tier(amount)` returning 'small' for amounts below 50, 'medium' for 50 up to but not including 500, and 'large' for 500 or more. Negative amounts or None return 'invalid'.",
  "starter": "def order_tier(amount):\n    raise NotImplementedError\n",
  "solution": "def order_tier(amount):\n    if amount is None or amount < 0:\n        return 'invalid'\n    if amount < 50:\n        return 'small'\n    elif amount < 500:\n        return 'medium'\n    return 'large'\n",
  "tests": "assert order_tier(20) == 'small'\nassert order_tier(50) == 'medium'\nassert order_tier(999.9) == 'large'\n",
  "hidden": "assert order_tier(None) == 'invalid'\nassert order_tier(-1) == 'invalid'\nassert order_tier(0) == 'small'\nassert order_tier(499.99) == 'medium'\nassert order_tier(500) == 'large'\n",
  "explanation": "Guarding invalid values first means the later comparisons only see valid numbers. Ordered elif checks give each half-open range exactly one label."
}
```
