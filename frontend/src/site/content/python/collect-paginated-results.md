---
id: PY-025
title: Collect Paginated Results
slug: collect-paginated-results
difficulty: Easy
category: etl
skill: ingestion
description: Follow next-page tokens to gather all items from an API.
topic: python-api-integration
concepts: while loops, dict lookup, pagination
time: O(n)
space: O(n)
minutes: 7
---

## Scenario

A customers API returns pages like {'items': [...], 'next': 'p2'}. The extractor must read every page until 'next' is None.

## Problem

Write `collect_all(pages, start)` where pages is a dict of token -> page (a stand-in for API calls). Starting at start, gather items from each page following 'next' until it is None. If a token repeats, raise RuntimeError to avoid an endless loop.

## Objective

Follow next tokens from the start page and collect every item, raising RuntimeError if a token repeats.

## Input format

A dict of pages and a start token.

## Output format

A list of all items.

## Constraints

- Missing 'items' counts as []

## Examples

```
collect_all({'p1': {'items': [1, 2], 'next': 'p2'}, 'p2': {'items': [3], 'next': None}}, 'p1')  ->  [1, 2, 3]
```

## Hints

- Loop while the token is not None.
- Keep a set of tokens already fetched.

## Why it matters

Almost every REST API paginates, and missing the last page or looping forever are classic extractor bugs. Tracking seen tokens is a cheap safety net.

```task
{
  "id": "collect-paginated-results",
  "title": "Collect Paginated Results",
  "type": "python",
  "instructions": "Write `collect_all(pages, start)` where pages is a dict of token -> page (a stand-in for API calls). Starting at start, gather items from each page following 'next' until it is None. If a token repeats, raise RuntimeError to avoid an endless loop.",
  "starter": "def collect_all(pages, start):\n    raise NotImplementedError\n",
  "solution": "def collect_all(pages, start):\n    items, seen, token = [], set(), start\n    while token is not None:\n        if token in seen:\n            raise RuntimeError(f'loop at {token}')\n        seen.add(token)\n        page = pages[token]\n        items.extend(page.get('items', []))\n        token = page.get('next')\n    return items\n",
  "tests": "assert collect_all({'p1': {'items': [1, 2], 'next': 'p2'}, 'p2': {'items': [3], 'next': None}}, 'p1') == [1, 2, 3]\n",
  "hidden": "assert collect_all({'a': {'next': None}}, 'a') == []\nassert collect_all({}, None) == []\ntry:\n    collect_all({'a': {'items': [1], 'next': 'b'}, 'b': {'items': [2], 'next': 'a'}}, 'a')\n    raise AssertionError('expected RuntimeError')\nexcept RuntimeError:\n    pass\npg = {str(i): {'items': [i], 'next': str(i + 1) if i < 199 else None} for i in range(200)}\nassert collect_all(pg, '0') == list(range(200))\n",
  "explanation": "The while loop follows next tokens until None, extending the result with each page. The seen set detects a cycle and fails loudly instead of looping forever."
}
```
