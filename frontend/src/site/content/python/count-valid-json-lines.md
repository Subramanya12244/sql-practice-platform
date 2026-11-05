---
id: PY-033
title: Count Valid JSON Lines
slug: count-valid-json-lines
difficulty: Easy
category: files
skill: validation
description: Read a JSON Lines file and count valid and invalid records.
topic: python-file-handling
concepts: open, json.loads, line iteration
time: O(n)
space: O(1)
minutes: 6
---

## Scenario

A clickstream exporter writes one JSON object per line, but crashes sometimes leave half-written lines.

## Problem

Write `count_jsonl(path)` that reads the file and returns (valid, invalid). Blank lines are ignored. A line is valid if it parses as a JSON object (dict); anything else is invalid.

## Objective

Read a JSON Lines file and return how many non-blank lines are valid JSON objects and how many are not.

## Input format

A file path.

## Output format

A tuple (int, int).

## Constraints

- Use a with block

## Examples

```
file lines: '{"a":1}', 'oops', '[1]'  ->  (1, 2)
```

## Hints

- Iterate the file object line by line.
- json.loads raises json.JSONDecodeError on bad input.

## Why it matters

JSON Lines is the most common format for event dumps. Counting bad lines tells you whether a file is safe to load.

```task
{
  "id": "count-valid-json-lines",
  "title": "Count Valid JSON Lines",
  "type": "python",
  "instructions": "Write `count_jsonl(path)` that reads the file and returns (valid, invalid). Blank lines are ignored. A line is valid if it parses as a JSON object (dict); anything else is invalid.",
  "starter": "def count_jsonl(path):\n    raise NotImplementedError\n",
  "solution": "import json\n\ndef count_jsonl(path):\n    valid = invalid = 0\n    with open(path) as f:\n        for line in f:\n            if not line.strip():\n                continue\n            try:\n                ok = isinstance(json.loads(line), dict)\n            except json.JSONDecodeError:\n                ok = False\n            if ok:\n                valid += 1\n            else:\n                invalid += 1\n    return valid, invalid\n",
  "tests": "with open('events.jsonl', 'w') as f:\n    f.write('{\"a\": 1}\\noops\\n[1]\\n')\nassert count_jsonl('events.jsonl') == (1, 2)\n",
  "hidden": "open('empty.jsonl', 'w').close()\nassert count_jsonl('empty.jsonl') == (0, 0)\nwith open('b.jsonl', 'w') as f:\n    f.write('\\n\\n{\"x\": 2}\\n  \\n{\"y\"\\n')\nassert count_jsonl('b.jsonl') == (1, 1)\nwith open('c.jsonl', 'w') as f:\n    f.write('{\"i\": 1}\\n' * 500)\nassert count_jsonl('c.jsonl') == (500, 0)\n",
  "explanation": "Reading line by line keeps memory flat for large files. Each non-blank line is parsed in try, and only dicts count as valid records."
}
```
