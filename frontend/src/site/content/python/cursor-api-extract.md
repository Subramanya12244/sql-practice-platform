---
id: PY-077
title: Extract All Pages From A Cursor API
slug: cursor-api-extract
difficulty: Medium
category: etl
skill: ingestion
description: Follow next cursors through a fake API, dedupe records by id and stop safely.
topic: python-api-integration
concepts: cursor pagination, page limit, dedup across pages
time: O(n)
space: O(n)
minutes: 15
---

## Scenario

A SaaS billing API returns invoices in pages with a next_cursor. Occasionally a record appears on two pages when data shifts during the extract.

## Problem

Write extract_all(fetch, max_pages=100). fetch(cursor) returns {'data': [records with 'id'], 'next_cursor': str or None}; the first call uses cursor None. Follow cursors until next_cursor is None. Keep the first copy of each id, preserving order. Raise RuntimeError if more than max_pages pages would be fetched or a cursor repeats. Return (records, pages_fetched).

## Objective

Implement robust cursor pagination with loop protection.

## Input format

fetch callable, int.

## Output format

tuple (list, int).

## Constraints

- No network: fetch is injected

## Examples

```
pages {None: ([1,2],'c1'), 'c1': ([2,3],None)}  ->  ([{'id':1},{'id':2},{'id':3}], 2)
```

## Hints

- Keep a set of seen ids and a set of seen cursors.
- Count pages before each call to enforce the limit.

## Why it matters

Almost every SaaS source paginates with cursors. Guarding against repeated cursors and runaway loops stops jobs from hanging or duplicating data.

```task
{
  "id": "cursor-api-extract",
  "title": "Extract All Pages From A Cursor API",
  "type": "python",
  "instructions": "Write extract_all(fetch, max_pages=100). fetch(cursor) returns {'data': [records with 'id'], 'next_cursor': str or None}; the first call uses cursor None. Follow cursors until next_cursor is None. Keep the first copy of each id, preserving order. Raise RuntimeError if more than max_pages pages would be fetched or a cursor repeats. Return (records, pages_fetched).",
  "starter": "def extract_all(fetch, max_pages: int = 100) -> tuple:\n    raise NotImplementedError\n",
  "solution": "def extract_all(fetch, max_pages: int = 100) -> tuple:\n    out, ids, cursors = [], set(), set()\n    cursor, pages = None, 0\n    while True:\n        if pages >= max_pages:\n            raise RuntimeError('too many pages')\n        page = fetch(cursor)\n        pages += 1\n        for r in page.get('data', []):\n            if r['id'] not in ids:\n                ids.add(r['id'])\n                out.append(r)\n        cursor = page.get('next_cursor')\n        if cursor is None:\n            return out, pages\n        if cursor in cursors:\n            raise RuntimeError('cursor repeated')\n        cursors.add(cursor)\n",
  "tests": "def api(pages):\n    return lambda c: {'data':[{'id':i} for i in pages[c][0]], 'next_cursor':pages[c][1]}\nassert extract_all(api({None:([1,2],'c1'),'c1':([2,3],None)})) == ([{'id':1},{'id':2},{'id':3}], 2)\nassert extract_all(api({None:([],None)})) == ([], 1)\n",
  "hidden": "def api(pages):\n    return lambda c: {'data':[{'id':i} for i in pages[c][0]], 'next_cursor':pages[c][1]}\ntry:\n    extract_all(api({None:([1],'a'),'a':([2],'b'),'b':([3],'a')})); assert False\nexcept RuntimeError:\n    pass\ntry:\n    extract_all(api({None:([1],'a'),'a':([2],None)}), max_pages=1); assert False\nexcept RuntimeError:\n    pass\nassert extract_all(api({None:([1],'a'),'a':([2],None)}), max_pages=2)[1] == 2\nbig={None:([0],'p1')}\nfor i in range(1,50):\n    big[f'p{i}'] = (list(range(i*10,i*10+10)), f'p{i+1}' if i<49 else None)\nr,n=extract_all(api(big))\nassert n==50 and len(r)==491\n",
  "explanation": "The loop calls fetch with the current cursor and stops when the API signals no next page. A seen-ids set keeps the first copy of shifted records while preserving order. A seen-cursors set detects a loop, and the page counter caps total calls, so the job fails loudly instead of spinning forever."
}
```
