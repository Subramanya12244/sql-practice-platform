---
id: PY-055
title: Safe Division
slug: safe-divide
difficulty: Easy
category: fundamentals
skill: reliability
description: Divide two values, returning None for division by zero or non-numbers.
topic: python-exceptions
concepts: try/except, specific exceptions
time: O(1)
space: O(1)
minutes: 5
---

## Scenario

A metrics job computes average order value as revenue divided by order count for each store. Some stores have zero orders and some rows carry non-numeric values from a bad upstream export.

## Problem

Return a / b. Return None if b is zero or if either value isn't a number (a `TypeError`). Don't catch every exception.

## Objective

Return a / b, or None when b is zero or either value is not a number, catching only those specific errors.

## Input format

Two values.

## Output format

A float or None.

## Constraints

- Catch only ZeroDivisionError and TypeError

## Examples

```
safe_divide(6, 3)  ->  2.0
safe_divide(1, 0)  ->  None
safe_divide('a', 2)  ->  None
```

## Hints

- List the exceptions in a tuple: `except (ZeroDivisionError, TypeError):`.
- Avoid a bare `except:`, which hides real bugs.

## Why it matters

Catching only the exceptions you expect keeps genuine bugs visible while letting a job survive known bad data, which is the balance every reliable pipeline needs.

```task
{
  "id": "safe-divide",
  "title": "Safe Division",
  "type": "python",
  "instructions": "Return a / b. Return None if b is zero or if either value isn't a number (a `TypeError`). Don't catch every exception.",
  "starter": "def safe_divide(a, b):\n    raise NotImplementedError\n",
  "solution": "def safe_divide(a, b):\n    try:\n        return a / b\n    except (ZeroDivisionError, TypeError):\n        return None\n",
  "tests": "assert safe_divide(6, 3) == 2.0\nassert safe_divide(1, 0) is None\nassert safe_divide('a', 2) is None\n",
  "hidden": "assert safe_divide(0, 5) == 0.0\nassert safe_divide(1, 0.0) is None\nassert safe_divide(None, 1) is None\nassert safe_divide(-9, 3) == -3.0\n",
  "explanation": "Catching only the expected exceptions keeps real bugs visible: a bare `except:` would also swallow KeyboardInterrupt or typos in your own code."
}
```
