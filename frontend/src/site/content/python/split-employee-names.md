---
id: PY-060
title: Split Employee Names
slug: split-employee-names
difficulty: Easy
category: fundamentals
skill: parsing
description: Split HR full names into first and last name fields.
topic: python-fundamentals
concepts: strip, split, maxsplit
time: O(n)
space: O(n)
minutes: 5
---

## Scenario

The HR export has one 'full_name' column, but the warehouse table needs separate first and last name columns.

## Problem

Write `split_name(full_name)` returning a tuple (first, last). Trim spaces and collapse extra whitespace. The first word is the first name; everything after it is the last name. A single word gives (word, ''). Empty or None gives ('', '').

## Objective

Split each full name into a trimmed (first, last) tuple, handling single words and blanks.

## Input format

A string or None.

## Output format

A tuple of two strings.

## Constraints

- Multiple spaces count as one separator

## Examples

```
split_name('  Ana  Maria Lopez ')  ->  ('Ana', 'Maria Lopez')
split_name('Cher')  ->  ('Cher', '')
```

## Hints

- str.split() with no argument drops extra whitespace.
- Join the remaining words back with a single space.

## Why it matters

Splitting and trimming free-text fields is daily work when loading HR or CRM data. Clear rules for edge cases avoid silent bad rows.

```task
{
  "id": "split-employee-names",
  "title": "Split Employee Names",
  "type": "python",
  "instructions": "Write `split_name(full_name)` returning a tuple (first, last). Trim spaces and collapse extra whitespace. The first word is the first name; everything after it is the last name. A single word gives (word, ''). Empty or None gives ('', '').",
  "starter": "def split_name(full_name):\n    raise NotImplementedError\n",
  "solution": "def split_name(full_name):\n    parts = (full_name or '').split()\n    if not parts:\n        return ('', '')\n    return (parts[0], ' '.join(parts[1:]))\n",
  "tests": "assert split_name('  Ana  Maria Lopez ') == ('Ana', 'Maria Lopez')\nassert split_name('Cher') == ('Cher', '')\n",
  "hidden": "assert split_name(None) == ('', '')\nassert split_name('   ') == ('', '')\nassert split_name('John Smith') == ('John', 'Smith')\nassert split_name('a\\tb  c') == ('a', 'b c')\n",
  "explanation": "split() without arguments removes all surrounding and repeated whitespace. The first token is the first name and the rest are rejoined with single spaces."
}
```
