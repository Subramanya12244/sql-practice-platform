---
id: PY-023
title: Cart Line Total
slug: cart-line-total
difficulty: Easy
category: fundamentals
skill: aggregation
description: Compute the total value of a shopping cart.
topic: python-loops
concepts: for loops, accumulation, rounding
time: O(n)
space: O(1)
minutes: 5
---

## Scenario

The checkout service sends cart line items and the revenue pipeline must recompute the cart total to verify it.

## Problem

Write `cart_total(items)` where each item is a dict with 'price' and 'qty'. Return the sum of price * qty rounded to 2 decimals. Skip items where qty is 0 or negative.

## Objective

Recompute the cart total from price and quantity, ignoring lines with no positive quantity.

## Input format

A list of dicts with price and qty.

## Output format

A float.

## Constraints

- Empty cart returns 0.0

## Examples

```
cart_total([{'price': 2.5, 'qty': 4}, {'price': 1.99, 'qty': 1}])  ->  11.99
```

## Hints

- Keep a running total in a loop.
- Round once at the end, not per line.

## Why it matters

Recomputing totals from line items is how engineers verify that upstream systems are correct. It is the basis of revenue reconciliation.

```task
{
  "id": "cart-line-total",
  "title": "Cart Line Total",
  "type": "python",
  "instructions": "Write `cart_total(items)` where each item is a dict with 'price' and 'qty'. Return the sum of price * qty rounded to 2 decimals. Skip items where qty is 0 or negative.",
  "starter": "def cart_total(items):\n    raise NotImplementedError\n",
  "solution": "def cart_total(items):\n    total = 0.0\n    for it in items:\n        if it['qty'] > 0:\n            total += it['price'] * it['qty']\n    return round(total, 2)\n",
  "tests": "assert cart_total([{'price': 2.5, 'qty': 4}, {'price': 1.99, 'qty': 1}]) == 11.99\nassert cart_total([{'price': 10, 'qty': 0}]) == 0.0\n",
  "hidden": "assert cart_total([]) == 0.0\nassert cart_total([{'price': 5, 'qty': -2}, {'price': 1, 'qty': 3}]) == 3.0\nassert cart_total([{'price': 0.1, 'qty': 3}]) == 0.3\nassert cart_total([{'price': 1, 'qty': 1}] * 1000) == 1000.0\n",
  "explanation": "The loop adds price times quantity for valid lines only. Rounding at the end avoids accumulating rounding errors line by line."
}
```
