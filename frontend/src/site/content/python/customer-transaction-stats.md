---
id: PY-099
title: Per-Customer Transaction Statistics
slug: customer-transaction-stats
difficulty: Medium
category: processing
skill: aggregation
description: Group transactions by customer and compute count, total, average, first and last date.
topic: python-collections
concepts: defaultdict, multi-metric aggregation, cleaning
time: O(n)
space: O(c)
minutes: 15
---

## Scenario

The CRM team wants a customer summary table built from raw card transactions, some of which have bad amounts.

## Problem

Write customer_stats(txns). Each txn has 'customer', 'amount' and 'date' (ISO 'YYYY-MM-DD'). Skip txns whose amount cannot be converted to float or customer is empty. Return {customer: {'count', 'total', 'avg', 'first', 'last'}} with total and avg rounded to 2.

## Objective

Compute several aggregates per group in one pass while skipping bad rows.

## Input format

list of dicts.

## Output format

dict of dicts.

## Constraints

- Amounts may be strings
- ISO dates compare correctly as strings

## Examples

```
[{'customer':'a','amount':'10','date':'2024-01-02'},{'customer':'a','amount':5,'date':'2024-01-01'}]
->  {'a':{'count':2,'total':15.0,'avg':7.5,'first':'2024-01-01','last':'2024-01-02'}}
```

## Hints

- Keep running count, total, min date and max date per customer.
- Wrap float() in try/except (TypeError, ValueError).

## Why it matters

Customer summary tables feed segmentation and churn models. Doing multi-metric aggregation in one pass and dropping unparsable values is everyday DE work.

```task
{
  "id": "customer-transaction-stats",
  "title": "Per-Customer Transaction Statistics",
  "type": "python",
  "instructions": "Write customer_stats(txns). Each txn has 'customer', 'amount' and 'date' (ISO 'YYYY-MM-DD'). Skip txns whose amount cannot be converted to float or customer is empty. Return {customer: {'count', 'total', 'avg', 'first', 'last'}} with total and avg rounded to 2.",
  "starter": "def customer_stats(txns: list) -> dict:\n    raise NotImplementedError\n",
  "solution": "def customer_stats(txns: list) -> dict:\n    acc = {}\n    for t in txns:\n        c = t.get('customer')\n        try:\n            amt = float(t.get('amount'))\n        except (TypeError, ValueError):\n            continue\n        if not c:\n            continue\n        s = acc.setdefault(c, {'count': 0, 'total': 0.0, 'first': t['date'], 'last': t['date']})\n        s['count'] += 1\n        s['total'] += amt\n        s['first'] = min(s['first'], t['date'])\n        s['last'] = max(s['last'], t['date'])\n    return {c: {'count': s['count'], 'total': round(s['total'], 2), 'avg': round(s['total'] / s['count'], 2),\n                'first': s['first'], 'last': s['last']} for c, s in acc.items()}\n",
  "tests": "assert customer_stats([{'customer':'a','amount':'10','date':'2024-01-02'},{'customer':'a','amount':5,'date':'2024-01-01'}]) == {'a':{'count':2,'total':15.0,'avg':7.5,'first':'2024-01-01','last':'2024-01-02'}}\nassert customer_stats([{'customer':'b','amount':'x','date':'2024-01-01'}]) == {}\n",
  "hidden": "assert customer_stats([]) == {}\nassert customer_stats([{'customer':'','amount':1,'date':'2024-01-01'}]) == {}\nassert customer_stats([{'customer':'c','amount':None,'date':'2024-01-01'},{'customer':'c','amount':'1','date':'2024-02-01'}]) == {'c':{'count':1,'total':1.0,'avg':1.0,'first':'2024-02-01','last':'2024-02-01'}}\nassert customer_stats([{'customer':'d','amount':1,'date':'2024-01-01'}]*3)['d']['avg'] == 1.0\nbig=[{'customer':f'c{i%3}','amount':i,'date':f'2024-01-{i%28+1:02d}'} for i in range(3000)]\nr=customer_stats(big)\nassert r['c0']['count']==1000 and r['c0']['first']=='2024-01-01'\n",
  "explanation": "One dict entry per customer holds running count, total and date range, so the data is scanned once. Conversion errors are caught and the row is skipped before it can corrupt totals. ISO dates sort lexicographically in date order, so min and max on strings are correct. Averages are derived at the end from total and count."
}
```
