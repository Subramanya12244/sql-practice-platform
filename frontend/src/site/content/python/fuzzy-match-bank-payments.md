---
id: PY-135
title: Match Bank Lines To Ledger With Tolerance
slug: fuzzy-match-bank-payments
difficulty: Hard
category: processing
skill: validation
description: Match ledger payments to bank statement lines with no shared id, using amount and date tolerances.
topic: python-collections
concepts: reconciliation, tolerance matching, greedy assignment, Decimal-free cents
time: O(L * B_c) where B_c is bank lines per customer
space: O(B)
minutes: 35
---

## Scenario

Finance reconciles the payments ledger against the bank statement every morning. The bank strips internal ids, rounds amounts and posts payments a day or two late, so an exact join leaves hundreds of false breaks.

## Problem

Write `match_payments(ledger, bank, amount_tol=0.01, day_tol=2)`. Ledger rows have `id`, `customer`, `amount`, `date` (ISO 'YYYY-MM-DD'); bank rows have `ref`, `customer`, `amount`, `date`. A bank line is a candidate for a ledger row when the customer is equal, the amounts differ by at most amount_tol (compare in integer cents to avoid float error) and the bank date is between 0 and day_tol days after the ledger date. Process ledger rows ordered by (date, id); each takes the unused candidate with the smallest (amount difference, day difference, ref). Each bank line can match once. Return `{'matched': [(id, ref), ...], 'unmatched_ledger': [...ids], 'unmatched_bank': [...refs]}` with all lists sorted.

## Objective

Implement deterministic one-to-one reconciliation with tolerances.

## Input format

Two lists of dicts plus tolerances.

## Output format

A dict of three sorted lists.

## Constraints

- Bank date must not be before the ledger date
- One-to-one matching
- Compare amounts in cents

## Examples

```
ledger = [{'id': 'L1', 'customer': 'c1', 'amount': 100.0, 'date': '2024-03-01'}]
bank = [{'ref': 'B9', 'customer': 'c1', 'amount': 100.01, 'date': '2024-03-02'}]
match_payments(ledger, bank)  ->  {'matched': [('L1', 'B9')], 'unmatched_ledger': [], 'unmatched_bank': []}
```

## Hints

- Group bank lines by customer first so each ledger row scans only its customer's lines.
- Use round(x * 100) for cents and date.fromisoformat for day differences.
- Keep a set of used refs; pick the best candidate with min() and a tuple key.

## Why it matters

Real reconciliations rarely have clean join keys, and finance teams judge a data platform by how few false breaks it reports. Tolerance matching with deterministic tie-breaks is the core of such jobs.

```task
{
  "id": "fuzzy-match-bank-payments",
  "title": "Match Bank Lines To Ledger With Tolerance",
  "type": "python",
  "instructions": "Write `match_payments(ledger, bank, amount_tol=0.01, day_tol=2)`. Ledger rows have `id`, `customer`, `amount`, `date` (ISO 'YYYY-MM-DD'); bank rows have `ref`, `customer`, `amount`, `date`. A bank line is a candidate for a ledger row when the customer is equal, the amounts differ by at most amount_tol (compare in integer cents to avoid float error) and the bank date is between 0 and day_tol days after the ledger date. Process ledger rows ordered by (date, id); each takes the unused candidate with the smallest (amount difference, day difference, ref). Each bank line can match once. Return `{'matched': [(id, ref), ...], 'unmatched_ledger': [...ids], 'unmatched_bank': [...refs]}` with all lists sorted.",
  "starter": "def match_payments(ledger, bank, amount_tol=0.01, day_tol=2) -> dict:\n    raise NotImplementedError\n",
  "solution": "from collections import defaultdict\nfrom datetime import date\n\n\ndef match_payments(ledger, bank, amount_tol=0.01, day_tol=2) -> dict:\n    tol = round(amount_tol * 100)\n    by_cust = defaultdict(list)\n    for b in bank:\n        by_cust[b[\"customer\"]].append(b)\n    used, matched, unmatched = set(), [], []\n    for l in sorted(ledger, key=lambda r: (r[\"date\"], r[\"id\"])):\n        ld, la = date.fromisoformat(l[\"date\"]), round(l[\"amount\"] * 100)\n        best = None\n        for b in by_cust.get(l[\"customer\"], []):\n            if b[\"ref\"] in used:\n                continue\n            da = abs(round(b[\"amount\"] * 100) - la)\n            dd = (date.fromisoformat(b[\"date\"]) - ld).days\n            if da <= tol and 0 <= dd <= day_tol:\n                k = (da, dd, b[\"ref\"])\n                if best is None or k < best:\n                    best = k\n        if best:\n            used.add(best[2])\n            matched.append((l[\"id\"], best[2]))\n        else:\n            unmatched.append(l[\"id\"])\n    return {\"matched\": sorted(matched), \"unmatched_ledger\": sorted(unmatched),\n            \"unmatched_bank\": sorted(b[\"ref\"] for b in bank if b[\"ref\"] not in used)}\n",
  "tests": "ledger = [{'id': 'L1', 'customer': 'c1', 'amount': 100.0, 'date': '2024-03-01'}]\nbank = [{'ref': 'B9', 'customer': 'c1', 'amount': 100.01, 'date': '2024-03-02'}]\nassert match_payments(ledger, bank) == {'matched': [('L1', 'B9')], 'unmatched_ledger': [], 'unmatched_bank': []}\nassert match_payments([], []) == {'matched': [], 'unmatched_ledger': [], 'unmatched_bank': []}\n",
  "hidden": "L = [{'id': 'L1', 'customer': 'c', 'amount': 50.0, 'date': '2024-01-10'}]\nassert match_payments(L, [{'ref': 'B', 'customer': 'c', 'amount': 50.0, 'date': '2024-01-09'}])['matched'] == []\nassert match_payments(L, [{'ref': 'B', 'customer': 'c', 'amount': 50.0, 'date': '2024-01-13'}])['unmatched_bank'] == ['B']\nassert match_payments(L, [{'ref': 'B', 'customer': 'd', 'amount': 50.0, 'date': '2024-01-10'}])['unmatched_ledger'] == ['L1']\nassert match_payments([{'id': 'x', 'customer': 'c', 'amount': 0.1 + 0.2, 'date': '2024-01-01'}], [{'ref': 'y', 'customer': 'c', 'amount': 0.31, 'date': '2024-01-01'}], amount_tol=0.01)['matched'] == [('x', 'y')]\nL2 = [{'id': 'L1', 'customer': 'c', 'amount': 10.0, 'date': '2024-01-01'}, {'id': 'L2', 'customer': 'c', 'amount': 10.0, 'date': '2024-01-01'}]\nB2 = [{'ref': 'B2', 'customer': 'c', 'amount': 10.0, 'date': '2024-01-02'}, {'ref': 'B1', 'customer': 'c', 'amount': 10.0, 'date': '2024-01-01'}, {'ref': 'B3', 'customer': 'c', 'amount': 10.01, 'date': '2024-01-01'}]\nr = match_payments(L2, B2)\nassert r == {'matched': [('L1', 'B1'), ('L2', 'B2')], 'unmatched_ledger': [], 'unmatched_bank': ['B3']}\n",
  "explanation": "Grouping bank lines by customer shrinks the candidate set for each ledger row. Amounts are converted to integer cents so that 0.1 + 0.2 compares correctly against 0.30 or 0.31 with a one-cent tolerance. Processing ledger rows in a fixed order and choosing the candidate with the smallest (amount gap, day gap, ref) makes the greedy assignment deterministic and prefers exact matches. A used set enforces one-to-one matching so one bank line cannot settle two payments. Leftovers on either side become the break report finance actually reviews."
}
```
