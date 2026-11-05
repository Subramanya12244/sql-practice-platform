---
id: PY-052
title: Price Lookup With Default
slug: price-lookup-default
difficulty: Easy
category: fundamentals
skill: transformation
description: Attach catalog prices to order lines with a fallback.
topic: python-collections
concepts: dict.get, list comprehension
time: O(n)
space: O(n)
minutes: 5
---

## Scenario

Order lines only carry a product id. The pipeline enriches each line with the price from a catalog dict.

## Problem

Write `enrich_prices(lines, catalog)` returning new dicts with all original keys plus 'price' from catalog by 'product_id'. If the product is missing, price is None. Do not modify the input dicts.

## Objective

Add a catalog price to every order line without mutating the input, using None for unknown products.

## Input format

A list of dicts and a dict of product_id -> price.

## Output format

A list of new dicts.

## Constraints

- Keep order

## Examples

```
enrich_prices([{'product_id': 'p1'}], {'p1': 9.5})  ->  [{'product_id': 'p1', 'price': 9.5}]
```

## Hints

- Use {**line, 'price': ...} to copy.
- catalog.get(key) returns None if missing.

## Why it matters

Enriching records with a lookup table is a dict-based join, one of the most common transforms in pipelines. Not mutating input keeps steps safe to rerun.

```task
{
  "id": "price-lookup-default",
  "title": "Price Lookup With Default",
  "type": "python",
  "instructions": "Write `enrich_prices(lines, catalog)` returning new dicts with all original keys plus 'price' from catalog by 'product_id'. If the product is missing, price is None. Do not modify the input dicts.",
  "starter": "def enrich_prices(lines, catalog):\n    raise NotImplementedError\n",
  "solution": "def enrich_prices(lines, catalog):\n    return [{**l, 'price': catalog.get(l.get('product_id'))} for l in lines]\n",
  "tests": "assert enrich_prices([{'product_id': 'p1'}], {'p1': 9.5}) == [{'product_id': 'p1', 'price': 9.5}]\nassert enrich_prices([{'product_id': 'x', 'qty': 2}], {}) == [{'product_id': 'x', 'qty': 2, 'price': None}]\n",
  "hidden": "assert enrich_prices([], {'a': 1}) == []\nsrc = [{'product_id': 'a'}]\nout = enrich_prices(src, {'a': 1})\nassert src == [{'product_id': 'a'}] and out[0]['price'] == 1\nassert enrich_prices([{}], {'a': 1}) == [{'price': None}]\n",
  "explanation": "Dict unpacking builds a fresh copy of each line so the input is untouched. dict.get returns None for unknown products instead of raising KeyError."
}
```
