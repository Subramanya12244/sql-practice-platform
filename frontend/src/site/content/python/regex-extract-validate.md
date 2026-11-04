---
title: Extract Emails and Validate Dates with Regex
slug: regex-extract-validate
difficulty: Medium
description: Pull email addresses from free text and validate ISO dates using regular expressions.
topic: python-regex
minutes: 20
---

## Problem

Write two functions:
- `def extract_emails(text: str) -> list`: return unique emails (lowercased) in first-seen order.
  An email is `local@domain.tld` where local uses letters, digits, `.`, `_`, `%`, `+`, `-`, and the TLD has 2+ letters.
- `def is_iso_date(s: str) -> bool`: `True` only for strings exactly matching `YYYY-MM-DD` that are real calendar dates.
`None` input returns `[]` / `False`.

## Examples

```
extract_emails("Mail A@x.com or b.c+1@y.co.uk, again a@x.com")  ->  ["a@x.com", "b.c+1@y.co.uk"]
is_iso_date("2024-02-29")  ->  True
is_iso_date("2023-02-29")  ->  False
```

## Hints

- Pattern: `[\\w.%+-]+@[\\w-]+(?:\\.[\\w-]+)*\\.[A-Za-z]{2,}`.
- Use `re.fullmatch` for the date shape, then `datetime.date(y, m, d)` inside try/except for validity.

```task
{
  "id": "regex-extract-validate",
  "title": "Extract Emails and Validate Dates with Regex",
  "type": "python",
  "instructions": "Write two functions:\n- `def extract_emails(text: str) -> list`: return unique emails (lowercased) in first-seen order.\n  An email is `local@domain.tld` where local uses letters, digits, `.`, `_`, `%`, `+`, `-`, and the TLD has 2+ letters.\n- `def is_iso_date(s: str) -> bool`: `True` only for strings exactly matching `YYYY-MM-DD` that are real calendar dates.\n`None` input returns `[]` / `False`.",
  "starter": "def extract_emails(text: str) -> list:\n    raise NotImplementedError\n\ndef is_iso_date(s: str) -> bool:\n    raise NotImplementedError\n",
  "solution": "import re, datetime\n\nEMAIL = re.compile(r\"[\\w.%+-]+@[\\w-]+(?:\\.[\\w-]+)*\\.[A-Za-z]{2,}\")\n\ndef extract_emails(text: str) -> list:\n    if not text:\n        return []\n    out = []\n    for m in EMAIL.findall(text):\n        m = m.lower()\n        if m not in out:\n            out.append(m)\n    return out\n\ndef is_iso_date(s: str) -> bool:\n    if not s or not re.fullmatch(r\"\\d{4}-\\d{2}-\\d{2}\", s):\n        return False\n    y, m, d = map(int, s.split(\"-\"))\n    try:\n        datetime.date(y, m, d)\n        return True\n    except ValueError:\n        return False\n",
  "tests": "assert extract_emails(\"Mail A@x.com or b.c+1@y.co.uk, again a@x.com\") == [\"a@x.com\", \"b.c+1@y.co.uk\"]\nassert extract_emails(\"\") == []\nassert extract_emails(None) == []\nassert extract_emails(\"bad@nodot and @x.com\") == []\nassert is_iso_date(\"2024-02-29\") is True\nassert is_iso_date(\"2023-02-29\") is False\nassert is_iso_date(\"2024-1-05\") is False\nassert is_iso_date(\"2024-01-05 \") is False\nassert is_iso_date(None) is False\n"
}
```
