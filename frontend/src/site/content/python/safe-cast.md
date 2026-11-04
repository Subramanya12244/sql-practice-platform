---
title: Exception-Safe Type Casting
slug: safe-cast
difficulty: Easy
description: Cast raw string values to a type, falling back to a default instead of crashing.
topic: python-exceptions
minutes: 10
---

## Problem

Write `def safe_cast(value, to_type, default=None)` that returns `to_type(value)`; if `value` is `None`
or the cast raises `ValueError` or `TypeError`, return `default`. Strings are stripped first.
Then write `def cast_column(values: list, to_type, default=None) -> list` applying it to each value.

## Examples

```
safe_cast(" 42 ", int)        ->  42
safe_cast("abc", int, -1)     ->  -1
cast_column(["1.5", "", None], float, 0.0)  ->  [1.5, 0.0, 0.0]
```

## Hints

- Catch only `(ValueError, TypeError)`; a bare `except` hides real bugs.
- Check `isinstance(value, str)` before stripping.

```task
{
  "id": "safe-cast",
  "title": "Exception-Safe Type Casting",
  "type": "python",
  "instructions": "Write `def safe_cast(value, to_type, default=None)` that returns `to_type(value)`; if `value` is `None`\nor the cast raises `ValueError` or `TypeError`, return `default`. Strings are stripped first.\nThen write `def cast_column(values: list, to_type, default=None) -> list` applying it to each value.",
  "starter": "def safe_cast(value, to_type, default=None):\n    raise NotImplementedError\n\ndef cast_column(values: list, to_type, default=None) -> list:\n    raise NotImplementedError\n",
  "solution": "def safe_cast(value, to_type, default=None):\n    if value is None:\n        return default\n    if isinstance(value, str):\n        value = value.strip()\n    try:\n        return to_type(value)\n    except (ValueError, TypeError):\n        return default\n\ndef cast_column(values: list, to_type, default=None) -> list:\n    return [safe_cast(v, to_type, default) for v in values]\n",
  "tests": "assert safe_cast(\" 42 \", int) == 42\nassert safe_cast(\"abc\", int, -1) == -1\nassert safe_cast(None, int, 7) == 7\nassert safe_cast(\"3.5\", int) is None\nassert safe_cast([1], int, 0) == 0\nassert cast_column([\"1.5\", \"\", None], float, 0.0) == [1.5, 0.0, 0.0]\nassert cast_column([], int) == []\n"
}
```
