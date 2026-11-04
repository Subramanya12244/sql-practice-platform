---
title: Functions
slug: python-functions
category: python
difficulty: Beginner
description: Python functions for pipelines - parameters, defaults, *args and **kwargs, return values, scope, type hints, pure transforms and decorators.
prerequisites: [python-loops]
related: [python-lambdas, python-modules-packages, python-exceptions, etl-transformation]
questions: []
patterns: []
guides: []
projects: [python-data-cleaning, csv-to-postgres-etl]
minutes: 9
version: 1
---

## Introduction

Good pipelines are small, named, testable functions: `extract()`, `transform()`, `load()`. Functions are also how Airflow tasks and pandas `apply` receive your logic.

## Definition

A function is a named, reusable block defined with `def`. It takes parameters, may return a value (else `None`), and is itself an object you can pass around.

## Why it matters

- Pure functions (output depends only on input) are easy to unit test.
- Defaults and keyword arguments make config explicit.
- Decorators add retries, timing or logging without touching the body.

## How it works

- Arguments bind by position, then by keyword.
- Defaults are evaluated once, at definition time.
- Name lookup follows LEGB: Local, Enclosing, Global, Built-in.
- `*args` collects extra positional args into a tuple, `**kwargs` extra keyword args into a dict.

## Syntax and configuration

```python-syntax
def name(pos, /, normal, *args, kw_only=default, **kwargs) -> ReturnType:
    """Docstring."""
    return value
```

## Examples

```python
def clean_name(name: str, *, upper: bool = False) -> str:
    """Trim and collapse whitespace."""
    out = " ".join(name.split())
    return out.upper() if upper else out

def summary(*amounts, **meta):
    return {"n": len(amounts), "total": sum(amounts), **meta}

print(clean_name("  Alfreds   Futterkiste "))
print(clean_name("chai", upper=True))
print(summary(10, 20, 5, source="orders"))
```

A retry decorator:

```python
import functools

def retry(times):
    def deco(fn):
        @functools.wraps(fn)
        def wrapper(*args, **kwargs):
            for attempt in range(1, times + 1):
                try:
                    return fn(*args, **kwargs)
                except ConnectionError:
                    if attempt == times:
                        raise
        return wrapper
    return deco

calls = {"n": 0}

@retry(times=3)
def flaky():
    calls["n"] += 1
    if calls["n"] < 3:
        raise ConnectionError("try again")
    return "ok"

print(flaky(), "after", calls["n"], "calls")
```

## Architecture

An ETL script as three composed functions.

```mermaid
flowchart LR
    extract["extract()"] --> transform["transform(rows)"]
    transform --> load["load(rows)"]
```

## Practical example

```python
import io, csv

RAW = "id,name,amount\n1, chai ,18\n2,chang,\n3,tofu,23.25\n"

def extract(text):
    return list(csv.DictReader(io.StringIO(text)))

def transform(rows):
    out = []
    for r in rows:
        if not r["amount"]:
            continue
        out.append({"id": int(r["id"]), "name": r["name"].strip().title(),
                    "amount": float(r["amount"])})
    return out

def load(rows, target):
    target.extend(rows)
    return len(rows)

warehouse = []
print(load(transform(extract(RAW)), warehouse), warehouse)
```

## Exercises

1. What is wrong with `def add(row, acc=[])`?
   <details><summary>Answer</summary>

   The list is created once and shared across calls. Use `acc=None` and create it inside.
   </details>
2. What does a function without `return` return?
   <details><summary>Answer</summary>

   `None`.
   </details>
3. Why use keyword-only arguments (`*,`)?
   <details><summary>Answer</summary>

   Callers must name them, so flags like `dry_run=True` are readable and cannot be passed by mistake.
   </details>

## Common mistakes

- Mutable default arguments.
- Functions that both transform and write (hard to test).
- Relying on global variables for config.
- Catching all exceptions inside a function and returning `None` silently.

## Performance and best practices

- Keep transforms pure; do I/O at the edges.
- Use `functools.lru_cache` for repeated expensive lookups.
- Add type hints and docstrings.
- Function call overhead matters in tight loops over millions of rows; vectorise instead.

## Interview questions

### What are *args and **kwargs?

They collect extra positional arguments into a tuple and extra keyword arguments into a dict.

### Why are mutable defaults dangerous?

Defaults are evaluated once at definition, so a list default is shared and grows across calls.

### What is a decorator?

A function that takes a function and returns a wrapped one, used for retries, logging or timing.

### What is a pure function and why does it matter in ETL?

Its output depends only on its inputs, with no side effects, so it is deterministic and easy to test and rerun.

## Quick revision

- `def f(a, b=1, *args, k=2, **kwargs)`.
- Defaults evaluated once: use `None` for mutable ones.
- LEGB scope.
- Decorators wrap behaviour (`functools.wraps`).
- Pure transforms, I/O at the edges.
