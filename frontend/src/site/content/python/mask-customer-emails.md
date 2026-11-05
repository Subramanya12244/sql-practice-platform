---
id: PY-044
title: Mask Customer Emails
slug: mask-customer-emails
difficulty: Easy
category: fundamentals
skill: cleaning
description: Hide the local part of customer emails before sharing an extract.
topic: python-fundamentals
concepts: string split, slicing, f-strings
time: O(n)
space: O(n)
minutes: 5
---

## Scenario

Support wants a customer list for a vendor, but privacy rules say emails must be masked before the file leaves the company.

## Problem

Write `mask_email(email)` that keeps the first character of the local part, replaces the rest of the local part with '***', and keeps the domain. If the value is not a string or has no '@', return None.

## Objective

Produce a privacy-safe version of each email while keeping the domain for analytics.

## Input format

A value expected to be an email string.

## Output format

A masked email string or None.

## Constraints

- Split on the last '@'
- An empty local part returns None

## Examples

```
mask_email('alice@shop.com')  ->  'a***@shop.com'
mask_email('bob')  ->  None
```

## Hints

- Use rpartition('@') to separate local part and domain.
- Check the type and that both parts are non-empty before formatting.

## Why it matters

Masking PII is a routine step before data is shared with analysts or vendors. Doing it safely on bad values keeps a pipeline from leaking or crashing.

```task
{
  "id": "mask-customer-emails",
  "title": "Mask Customer Emails",
  "type": "python",
  "instructions": "Write `mask_email(email)` that keeps the first character of the local part, replaces the rest of the local part with '***', and keeps the domain. If the value is not a string or has no '@', return None.",
  "starter": "def mask_email(email):\n    raise NotImplementedError\n",
  "solution": "def mask_email(email):\n    if not isinstance(email, str) or '@' not in email:\n        return None\n    local, _, domain = email.rpartition('@')\n    if not local or not domain:\n        return None\n    return f'{local[0]}***@{domain}'\n",
  "tests": "assert mask_email('alice@shop.com') == 'a***@shop.com'\nassert mask_email('bob') is None\n",
  "hidden": "assert mask_email(None) is None\nassert mask_email('@x.com') is None\nassert mask_email('z@corp.io') == 'z***@corp.io'\nassert mask_email('a@b@c.com') == 'a***@c.com'\nassert mask_email(42) is None\n",
  "explanation": "rpartition splits on the last '@', so the domain is always the real domain. Type and emptiness checks come first, so bad values return None instead of raising."
}
```
