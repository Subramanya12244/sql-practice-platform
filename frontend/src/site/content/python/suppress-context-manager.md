---
id: PY-106
title: Suppress-And-Record Context Manager
slug: suppress-context-manager
difficulty: Medium
category: advanced
skill: reliability
description: A context manager that swallows chosen exceptions and remembers them.
topic: python-exceptions
concepts: __enter__, __exit__, exception types
time: O(1)
space: O(1)
minutes: 15
---

## Scenario

A batch job processes each customer record inside a block that may raise known data errors like ValueError. Those errors should be recorded for the error report without stopping the job, while unexpected errors still surface.

## Problem

`with Suppress(ValueError, KeyError) as s:` runs the block; if it raises one of the given types, the exception is stored in `s.error` and swallowed. Other exceptions propagate. `s.error` is None if nothing was raised.

## Objective

Build a Suppress context manager that swallows and stores only the given exception types, letting others propagate.

## Input format

Exception types.

## Output format

The context manager object.

## Constraints

- Subclasses of listed types are suppressed too

## Examples

```
with Suppress(ValueError) as s:
    int('x')
s.error  ->  ValueError(...)
```

## Hints

- `__exit__` receives (exc_type, exc, tb); returning True swallows the exception.
- `issubclass(exc_type, self.types)` works with a tuple of types.

## Why it matters

Context managers give pipelines a clean, reusable way to handle expected failures per record while keeping unexpected bugs visible.

```task
{
  "id": "suppress-context-manager",
  "title": "Suppress-And-Record Context Manager",
  "type": "python",
  "instructions": "`with Suppress(ValueError, KeyError) as s:` runs the block; if it raises one of the given types, the exception is stored in `s.error` and swallowed. Other exceptions propagate. `s.error` is None if nothing was raised.",
  "starter": "class Suppress:\n    def __init__(self, *types):\n        raise NotImplementedError\n",
  "solution": "class Suppress:\n    def __init__(self, *types):\n        self.types = types\n        self.error = None\n\n    def __enter__(self):\n        return self\n\n    def __exit__(self, exc_type, exc, tb):\n        if exc_type is not None and issubclass(exc_type, self.types):\n            self.error = exc\n            return True\n        return False\n",
  "tests": "with Suppress(ValueError) as s:\n    int('x')\nassert isinstance(s.error, ValueError)\nwith Suppress(ValueError) as s:\n    pass\nassert s.error is None\n",
  "hidden": "try:\n    with Suppress(KeyError):\n        1 / 0\n    raise AssertionError('should propagate')\nexcept ZeroDivisionError:\n    pass\nclass MyErr(LookupError):\n    pass\nwith Suppress(LookupError) as s:\n    raise MyErr('x')\nassert isinstance(s.error, MyErr)\nwith Suppress(ValueError, KeyError) as s:\n    {}['missing']\nassert isinstance(s.error, KeyError)\n",
  "explanation": "Python calls `__exit__` whether or not the block raised. Returning True tells it the exception was handled; returning False lets it continue upward. `issubclass` with a tuple accepts any listed type or subclass."
}
```
