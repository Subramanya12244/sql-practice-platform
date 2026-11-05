---
id: PY-105
title: Standardise Customer Contact Fields
slug: clean-contact-fields
difficulty: Medium
category: processing
skill: cleaning
description: Clean names, emails and phone numbers in customer records with simple rules.
topic: python-regex
concepts: re.sub, normalisation rules, field-level cleaning
time: O(n)
space: O(n)
minutes: 15
---

## Scenario

A marketing list merged from forms has inconsistent casing, stray spaces and phone formats. The CDP needs standard values before matching.

## Problem

Write clean_contacts(rows). For each dict: 'name' -> collapse whitespace and title-case; 'email' -> strip and lowercase, None if it does not match one '@' with a dot in the domain; 'phone' -> keep digits only, drop a leading '00' (replace with nothing) and return '+' + digits if 10 to 15 digits remain, else None. Missing fields become None. Return new dicts with exactly these three keys plus 'id'.

## Objective

Apply several field-level normalisation rules in one transform.

## Input format

list of dicts.

## Output format

list of dicts.

## Constraints

- Use the standard re module

## Examples

```
{'id':1,'name':'  aNNa   smith','email':' Anna@Mail.COM ','phone':'0049 (170) 123-4567'}
->  {'id':1,'name':'Anna Smith','email':'anna@mail.com','phone':'+491701234567'}
```

## Hints

- re.sub(r'\D', '', s) keeps only digits.
- ' '.join(s.split()) collapses whitespace.

## Why it matters

Standardising contact fields is a prerequisite for identity resolution and dedup. Small regex rules applied consistently fix most real-world mess.

```task
{
  "id": "clean-contact-fields",
  "title": "Standardise Customer Contact Fields",
  "type": "python",
  "instructions": "Write clean_contacts(rows). For each dict: 'name' -> collapse whitespace and title-case; 'email' -> strip and lowercase, None if it does not match one '@' with a dot in the domain; 'phone' -> keep digits only, drop a leading '00' (replace with nothing) and return '+' + digits if 10 to 15 digits remain, else None. Missing fields become None. Return new dicts with exactly these three keys plus 'id'.",
  "starter": "def clean_contacts(rows: list) -> list:\n    raise NotImplementedError\n",
  "solution": "import re\n\nEMAIL = re.compile(r'^[^@\\s]+@[^@\\s]+\\.[^@\\s]+$')\n\ndef clean_contacts(rows: list) -> list:\n    out = []\n    for r in rows:\n        name = r.get('name')\n        name = ' '.join(name.split()).title() if name and name.strip() else None\n        email = r.get('email')\n        email = email.strip().lower() if email else None\n        if email and not EMAIL.match(email):\n            email = None\n        phone = r.get('phone')\n        if phone:\n            d = re.sub(r'\\D', '', str(phone))\n            if d.startswith('00'):\n                d = d[2:]\n            phone = '+' + d if 10 <= len(d) <= 15 else None\n        else:\n            phone = None\n        out.append({'id': r.get('id'), 'name': name, 'email': email, 'phone': phone})\n    return out\n",
  "tests": "assert clean_contacts([{'id':1,'name':'  aNNa   smith','email':' Anna@Mail.COM ','phone':'0049 (170) 123-4567'}]) == [{'id':1,'name':'Anna Smith','email':'anna@mail.com','phone':'+491701234567'}]\nassert clean_contacts([{'id':2,'email':'bad@nodot','phone':'123'}]) == [{'id':2,'name':None,'email':None,'phone':None}]\n",
  "hidden": "assert clean_contacts([]) == []\nassert clean_contacts([{'id':3,'name':'   '}])[0]['name'] is None\nassert clean_contacts([{'id':4,'email':'a@b@c.com'}])[0]['email'] is None\nassert clean_contacts([{'id':5,'phone':'+1 415 555 0100'}])[0]['phone'] == '+14155550100'\nassert clean_contacts([{'id':6,'phone':'1'*16}])[0]['phone'] is None\nassert clean_contacts([{'id':7,'phone':4155550100}])[0]['phone'] == '+4155550100'\n",
  "explanation": "Each field has its own rule, applied independently so one bad field does not discard the record. Splitting and rejoining collapses any whitespace before title-casing. The email regex demands exactly one '@' and a dotted domain. Stripping non-digits and the 00 prefix yields an E.164-like number, with a length check rejecting junk."
}
```
