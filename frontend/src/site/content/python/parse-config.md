---
id: PY-096
title: Parse A Key-Value Config File
slug: parse-config
difficulty: Medium
category: files
skill: parsing
description: Parse key = value lines into typed values.
topic: python-file-handling
concepts: string parsing, type conversion, comments
time: O(n)
space: O(n)
minutes: 15
---

## Scenario

A pipeline reads its settings from a simple key = value file with comments, booleans and integers. A typo in the file should fail fast and point to the offending line.

## Problem

Parse lines of `key = value`. Ignore blank lines and lines starting with '#'. Convert 'true'/'false' (any case) to bool and integer strings to int; keep everything else as a stripped string. Raise ValueError (with the line number) for a line without '='.

## Objective

Parse key = value lines into a typed dict, ignoring blanks and comments, and raise ValueError with the line number for lines without '='.

## Input format

The config file contents.

## Output format

A dict.

## Constraints

- Only the first '=' separates key and value

## Examples

```
parse_config('port = 8080\ndebug=TRUE\n# c\nname = api')  ->  {'port': 8080, 'debug': True, 'name': 'api'}
```

## Hints

- `line.partition('=')` splits at the first '='.
- Try `int(value)` inside try/except ValueError.

## Why it matters

Pipelines depend on config files, and typed parsing with precise errors stops misconfigured jobs before they touch data.

```task
{
  "id": "parse-config",
  "title": "Parse A Key-Value Config File",
  "type": "python",
  "instructions": "Parse lines of `key = value`. Ignore blank lines and lines starting with '#'. Convert 'true'/'false' (any case) to bool and integer strings to int; keep everything else as a stripped string. Raise ValueError (with the line number) for a line without '='.",
  "starter": "def parse_config(text: str) -> dict:\n    raise NotImplementedError\n",
  "solution": "def parse_config(text: str) -> dict:\n    out = {}\n    for n, raw in enumerate(text.splitlines(), 1):\n        line = raw.strip()\n        if not line or line.startswith('#'):\n            continue\n        key, sep, value = line.partition('=')\n        if not sep:\n            raise ValueError(f'line {n}: expected key = value')\n        key, value = key.strip(), value.strip()\n        if value.lower() in ('true', 'false'):\n            out[key] = value.lower() == 'true'\n        else:\n            try:\n                out[key] = int(value)\n            except ValueError:\n                out[key] = value\n    return out\n",
  "tests": "assert parse_config('port = 8080\\ndebug=TRUE\\n# c\\nname = api') == {'port': 8080, 'debug': True, 'name': 'api'}\n",
  "hidden": "assert parse_config('') == {}\nassert parse_config('url = a=b') == {'url': 'a=b'}\nassert parse_config('n = -3\\nf = 1.5') == {'n': -3, 'f': '1.5'}\ntry:\n    parse_config('ok = 1\\nbroken')\n    raise AssertionError('expected ValueError')\nexcept ValueError as e:\n    assert '2' in str(e)\n",
  "explanation": "`partition` splits at the first separator only, so values may contain '='. Converting with try/except follows Python's 'ask forgiveness' style, and the line number makes errors easy to fix."
}
```
