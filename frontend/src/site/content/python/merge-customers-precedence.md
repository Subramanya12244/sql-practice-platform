---
id: PY-088
title: Merge Customer Records With Source Precedence
slug: merge-customers-precedence
difficulty: Medium
category: fundamentals
skill: transformation
description: Merge customer profiles from CRM and billing, preferring CRM values unless they are missing.
topic: python-collections
concepts: dict merge, precedence rules, None handling
time: O(n log n)
space: O(n)
minutes: 15
---

## Scenario

Customer profiles live in a CRM and in a billing system. The analytics team wants one golden record per customer.

## Problem

Write merge_customers(crm, billing). Both are lists of dicts with an 'id' key. For each id in either source, build one dict: start from the billing record, then overlay CRM fields whose value is not None and not an empty string. Return the merged records sorted by id.

## Objective

Combine two sources into one record per key using a field-level precedence rule.

## Input format

crm: list of dicts, billing: list of dicts; every dict has 'id'.

## Output format

List of merged dicts sorted by 'id'.

## Constraints

- CRM wins only for non-empty values
- An id present in one source only is kept as is

## Examples

```
crm=[{'id':1,'email':'a@x.com','phone':None}], billing=[{'id':1,'email':'old@x.com','phone':'555'}]
->  [{'id':1,'email':'a@x.com','phone':'555'}]
```

## Hints

- Index billing by id in a dict first.
- Copy the billing dict, then loop over CRM items and skip None or ''.

## Why it matters

Golden-record building is a daily task in customer data platforms. Field-level precedence with null handling is exactly how MDM merges are specified.

```task
{
  "id": "merge-customers-precedence",
  "title": "Merge Customer Records With Source Precedence",
  "type": "python",
  "instructions": "Write merge_customers(crm, billing). Both are lists of dicts with an 'id' key. For each id in either source, build one dict: start from the billing record, then overlay CRM fields whose value is not None and not an empty string. Return the merged records sorted by id.",
  "starter": "def merge_customers(crm: list, billing: list) -> list:\n    raise NotImplementedError\n",
  "solution": "def merge_customers(crm: list, billing: list) -> list:\n    out = {r['id']: dict(r) for r in billing}\n    for r in crm:\n        rec = out.setdefault(r['id'], {'id': r['id']})\n        for k, v in r.items():\n            if v is not None and v != '':\n                rec[k] = v\n    return [out[k] for k in sorted(out)]\n",
  "tests": "assert merge_customers([{'id':1,'email':'a@x.com','phone':None}], [{'id':1,'email':'old@x.com','phone':'555'}]) == [{'id':1,'email':'a@x.com','phone':'555'}]\nassert merge_customers([{'id':2,'name':'Bo'}], [{'id':1,'name':'Al'}]) == [{'id':1,'name':'Al'},{'id':2,'name':'Bo'}]\n",
  "hidden": "assert merge_customers([], []) == []\nassert merge_customers([{'id':1,'name':''}], [{'id':1,'name':'Al'}]) == [{'id':1,'name':'Al'}]\nassert merge_customers([{'id':1,'tier':'gold'}], []) == [{'id':1,'tier':'gold'}]\nassert merge_customers([{'id':3,'x':0}], [{'id':3,'x':5,'y':1}]) == [{'id':3,'x':0,'y':1}]\nb=[{'id':i,'v':i} for i in range(1000)]\nassert merge_customers([{'id':999,'v':None}], b)[-1] == {'id':999,'v':999}\n",
  "explanation": "Billing records form the base, so every field billing knows about is present. CRM values then overwrite only when they carry real data, which implements the precedence rule. Using setdefault creates CRM-only customers. Note that 0 is a real value and is kept; only None and '' are treated as missing. Sorting the keys gives deterministic output."
}
```
