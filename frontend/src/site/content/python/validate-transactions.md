---
id: PY-113
title: Validate Transactions And Collect Errors
slug: validate-transactions
difficulty: Medium
category: processing
skill: validation
description: Split records into valid rows and error messages instead of failing on the first problem.
topic: python-etl-pipelines
concepts: validation, error collection, data quality
time: O(n)
space: O(n)
minutes: 15
---

## Scenario

A payments feed sends transaction records with id, amount and currency, and some arrive with missing ids, non-numeric or negative amounts, or unsupported currencies. Valid rows should load while every bad row is reported with a reason.

## Problem

Each record has id, amount and currency. A record is valid when id is a non-empty string, amount is a number > 0 (not bool) and currency is one of 'USD', 'EUR', 'GBP'. Return (valid_records, errors) where errors is a list of 'id: reason' strings (id '?' if missing), checking rules in that order and reporting only the first failure per record.

## Objective

Split records into valid ones and 'id: reason' error strings, applying the rules in order and reporting only the first failure.

## Input format

A list of dicts.

## Output format

A (list, list) tuple.

## Constraints

- Never raise for bad data

## Examples

```
validate([{'id': 't1', 'amount': 5, 'currency': 'USD'}, {'id': 't2', 'amount': -1, 'currency': 'USD'}])  ->  ([{...t1}], ['t2: amount must be > 0'])
```

## Hints

- Write the checks as a list of (test, message) pairs.
- Use `.get()` so missing keys don't raise.

## Why it matters

Collecting errors instead of failing on the first bad row is how production loaders quarantine bad data while keeping good data flowing.

```task
{
  "id": "validate-transactions",
  "title": "Validate Transactions And Collect Errors",
  "type": "python",
  "instructions": "Each record has id, amount and currency. A record is valid when id is a non-empty string, amount is a number > 0 (not bool) and currency is one of 'USD', 'EUR', 'GBP'. Return (valid_records, errors) where errors is a list of 'id: reason' strings (id '?' if missing), checking rules in that order and reporting only the first failure per record.",
  "starter": "def validate(records: list) -> tuple:\n    raise NotImplementedError\n",
  "solution": "CURRENCIES = {'USD', 'EUR', 'GBP'}\n\n\ndef validate(records: list) -> tuple:\n    valid, errors = [], []\n    for r in records:\n        rid = r.get('id')\n        label = rid if isinstance(rid, str) and rid else '?'\n        amount = r.get('amount')\n        checks = [\n            (isinstance(rid, str) and rid != '', 'missing id'),\n            (isinstance(amount, (int, float)) and not isinstance(amount, bool), 'amount must be a number'),\n            (isinstance(amount, (int, float)) and not isinstance(amount, bool) and amount > 0, 'amount must be > 0'),\n            (r.get('currency') in CURRENCIES, 'unknown currency'),\n        ]\n        failure = next((msg for ok, msg in checks if not ok), None)\n        if failure:\n            errors.append(f'{label}: {failure}')\n        else:\n            valid.append(r)\n    return valid, errors\n",
  "tests": "v, e = validate([{'id': 't1', 'amount': 5, 'currency': 'USD'}, {'id': 't2', 'amount': -1, 'currency': 'USD'}])\nassert [r['id'] for r in v] == ['t1']\nassert e == ['t2: amount must be > 0']\n",
  "hidden": "recs = [{'amount': 1, 'currency': 'USD'}, {'id': 'a', 'amount': '5', 'currency': 'EUR'}, {'id': 'b', 'amount': True, 'currency': 'EUR'}, {'id': 'c', 'amount': 2.5, 'currency': 'JPY'}, {'id': 'd', 'amount': 2.5, 'currency': 'GBP'}]\nv, e = validate(recs)\nassert [r['id'] for r in v] == ['d']\nassert e == ['?: missing id', 'a: amount must be a number', 'b: amount must be a number', 'c: unknown currency']\nassert validate([]) == ([], [])\n",
  "explanation": "Collecting errors instead of raising lets a pipeline load the good rows and report all the bad ones in one run. Ordered checks with `next(...)` give one clear reason per record."
}
```
