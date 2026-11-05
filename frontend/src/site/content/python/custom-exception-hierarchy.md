---
id: PY-072
title: Custom Exception Hierarchy
slug: custom-exception-hierarchy
difficulty: Medium
category: fundamentals
skill: validation
description: Design exceptions for an order-processing step.
topic: python-exceptions
concepts: exception classes, inheritance, raise from
time: O(1)
space: O(1)
minutes: 15
---

## Scenario

An order-processing service prices each incoming order against a product catalogue. Bad quantities and unknown products must raise distinct, catchable errors so the caller can route each order to the right error queue.

## Problem

Define `OrderError` with subclasses `InvalidQuantity` and `UnknownProduct`. Write `process(order, catalogue)` returning quantity × price, raising InvalidQuantity for quantity ≤ 0 and UnknownProduct (chained from the KeyError with `raise ... from`) when the product isn't in the catalogue.

## Objective

Define an OrderError hierarchy and a process function that prices an order or raises the matching subclass, chaining the original KeyError.

## Input format

order = {'product': str, 'quantity': int}; catalogue = {product: price}.

## Output format

A number or an exception.

## Constraints

- UnknownProduct.__cause__ is the KeyError

## Examples

```
process({'product': 'tea', 'quantity': 2}, {'tea': 3.5})  ->  7.0
```

## Hints

- Subclass to let callers catch all order errors with `except OrderError`.
- `raise UnknownProduct(...) from err` keeps the original error as __cause__.

## Why it matters

A clear exception hierarchy lets pipelines handle each failure type differently, such as quarantining bad records while retrying transient ones, and exception chaining keeps the root cause in the logs.

```task
{
  "id": "custom-exception-hierarchy",
  "title": "Custom Exception Hierarchy",
  "type": "python",
  "instructions": "Define `OrderError` with subclasses `InvalidQuantity` and `UnknownProduct`. Write `process(order, catalogue)` returning quantity × price, raising InvalidQuantity for quantity ≤ 0 and UnknownProduct (chained from the KeyError with `raise ... from`) when the product isn't in the catalogue.",
  "starter": "class OrderError(Exception):\n    pass\n\n\ndef process(order: dict, catalogue: dict) -> float:\n    raise NotImplementedError\n",
  "solution": "class OrderError(Exception):\n    pass\n\n\nclass InvalidQuantity(OrderError):\n    pass\n\n\nclass UnknownProduct(OrderError):\n    pass\n\n\ndef process(order: dict, catalogue: dict) -> float:\n    qty = order['quantity']\n    if qty <= 0:\n        raise InvalidQuantity(f'quantity must be positive, got {qty}')\n    try:\n        price = catalogue[order['product']]\n    except KeyError as err:\n        raise UnknownProduct(order['product']) from err\n    return qty * price\n",
  "tests": "assert process({'product': 'tea', 'quantity': 2}, {'tea': 3.5}) == 7.0\n",
  "hidden": "assert issubclass(InvalidQuantity, OrderError) and issubclass(UnknownProduct, OrderError)\ntry:\n    process({'product': 'x', 'quantity': 0}, {'x': 1})\n    raise AssertionError('expected InvalidQuantity')\nexcept InvalidQuantity:\n    pass\ntry:\n    process({'product': 'nope', 'quantity': 1}, {})\n    raise AssertionError('expected UnknownProduct')\nexcept OrderError as e:\n    assert isinstance(e, UnknownProduct) and isinstance(e.__cause__, KeyError)\n",
  "explanation": "A shared base class lets callers handle any order problem in one except clause while still distinguishing specific cases. `raise ... from err` records the KeyError as the cause, so tracebacks show both."
}
```
