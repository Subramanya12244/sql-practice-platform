---
id: PY-069
title: Convert Order Amounts To A Base Currency
slug: currency-normalise-orders
difficulty: Medium
category: processing
skill: transformation
description: Convert multi-currency orders to EUR using the rate effective on each order date.
topic: python-collections
concepts: rate lookup, date-effective rates, bisect
time: O((n + r) log r)
space: O(r)
minutes: 20
---

## Scenario

Orders arrive in USD, GBP and EUR. Finance reports in EUR using the latest rate published on or before the order date.

## Problem

Write to_eur(orders, rates). orders: dicts with 'id', 'amount', 'currency', 'date' (ISO). rates: dict currency -> list of (date, rate_to_eur), unsorted. EUR orders use rate 1. Return (converted, unconverted) where converted is a list of {'id','amount_eur'} (rounded 2) and unconverted is a sorted list of ids with no usable rate.

## Objective

Join each row to a time-varying reference table by as-of date.

## Input format

orders list, rates dict.

## Output format

tuple (list, list).

## Constraints

- A rate published on the order date applies
- Orders dated before the first rate are unconverted

## Examples

```
rates={'USD':[('2024-01-10',0.9),('2024-01-01',0.95)]}
to_eur([{'id':1,'amount':100,'currency':'USD','date':'2024-01-05'}], rates)  ->  ([{'id':1,'amount_eur':95.0}], [])
```

## Hints

- Sort each currency's rates by date and keep the dates in a separate list.
- bisect_right on the dates finds the latest rate on or before the order date.

## Why it matters

As-of joins to FX or price tables are common in finance pipelines. Getting effective-date logic right avoids silent revenue errors.

```task
{
  "id": "currency-normalise-orders",
  "title": "Convert Order Amounts To A Base Currency",
  "type": "python",
  "instructions": "Write to_eur(orders, rates). orders: dicts with 'id', 'amount', 'currency', 'date' (ISO). rates: dict currency -> list of (date, rate_to_eur), unsorted. EUR orders use rate 1. Return (converted, unconverted) where converted is a list of {'id','amount_eur'} (rounded 2) and unconverted is a sorted list of ids with no usable rate.",
  "starter": "def to_eur(orders: list, rates: dict) -> tuple:\n    raise NotImplementedError\n",
  "solution": "from bisect import bisect_right\n\ndef to_eur(orders: list, rates: dict) -> tuple:\n    table = {}\n    for cur, rs in rates.items():\n        rs = sorted(rs)\n        table[cur] = ([d for d, _ in rs], [r for _, r in rs])\n    done, missing = [], []\n    for o in orders:\n        cur = o['currency']\n        if cur == 'EUR':\n            rate = 1\n        elif cur in table:\n            dates, vals = table[cur]\n            i = bisect_right(dates, o['date']) - 1\n            rate = vals[i] if i >= 0 else None\n        else:\n            rate = None\n        if rate is None:\n            missing.append(o['id'])\n        else:\n            done.append({'id': o['id'], 'amount_eur': round(o['amount'] * rate, 2)})\n    return done, sorted(missing)\n",
  "tests": "rates={'USD':[('2024-01-10',0.9),('2024-01-01',0.95)]}\nassert to_eur([{'id':1,'amount':100,'currency':'USD','date':'2024-01-05'}], rates) == ([{'id':1,'amount_eur':95.0}], [])\nassert to_eur([{'id':2,'amount':100,'currency':'USD','date':'2024-01-10'},{'id':3,'amount':5,'currency':'EUR','date':'2023-01-01'}], rates) == ([{'id':2,'amount_eur':90.0},{'id':3,'amount_eur':5}], [])\n",
  "hidden": "rates={'USD':[('2024-01-10',0.9),('2024-01-01',0.95)]}\nassert to_eur([], rates) == ([], [])\nassert to_eur([{'id':4,'amount':1,'currency':'USD','date':'2023-12-31'}], rates) == ([], [4])\nassert to_eur([{'id':9,'amount':1,'currency':'GBP','date':'2024-01-01'},{'id':5,'amount':1,'currency':'JPY','date':'2024-01-01'}], rates) == ([], [5,9])\nassert to_eur([{'id':6,'amount':10,'currency':'USD','date':'2030-01-01'}], rates) == ([{'id':6,'amount_eur':9.0}], [])\nassert to_eur([{'id':7,'amount':1,'currency':'USD','date':'2024-01-01'}], {'USD':[]}) == ([], [7])\n",
  "explanation": "Rates are sorted once per currency so each lookup is a binary search. bisect_right returns the count of rate dates <= order date, so subtracting one picks the latest effective rate, including one published on the same day. An index of -1 or an unknown currency means no rate applies, and the id goes to the unconverted list instead of being guessed."
}
```
