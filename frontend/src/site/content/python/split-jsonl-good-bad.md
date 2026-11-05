---
id: PY-103
title: Split A JSON Lines File Into Good And Rejected
slug: split-jsonl-good-bad
difficulty: Medium
category: files
skill: ingestion
description: Stream a JSONL file, write valid events to one file and bad lines with reasons to another.
topic: python-csv-json
concepts: JSON lines, file IO, reject file with reasons
time: O(n)
space: O(1)
minutes: 15
---

## Scenario

A clickstream collector writes events.jsonl. Some lines are truncated or missing fields. Loading must continue while bad lines are kept for investigation.

## Problem

Write split_jsonl(src, good_path, bad_path, required). Read src line by line, skipping blank lines. A line is good if it parses as a JSON object containing every required key. Write good objects to good_path as JSON lines (json.dumps with sort_keys=True). Write bad lines to bad_path as JSON lines {'line': line_number (1-based), 'reason': 'invalid_json' | 'not_object' | 'missing:<key>', 'raw': stripped text}; for missing keys report the first missing key in required order. Return (good_count, bad_count).

## Objective

Process a file line by line with per-line error handling and a reject output.

## Input format

Three file paths and a list of keys.

## Output format

tuple of two ints.

## Constraints

- Files are in the current directory
- Do not load the whole file into memory

## Examples

```
events.jsonl: '{"id":1,"type":"view"}\n{bad\n' required ['id','type']  ->  (1, 1)
```

## Hints

- Open all three files in one with statement.
- json.JSONDecodeError is a subclass of ValueError.

## Why it matters

Dead-letter or reject files are how production loaders survive bad input without losing it. Line numbers and reasons make the fix fast.

```task
{
  "id": "split-jsonl-good-bad",
  "title": "Split A JSON Lines File Into Good And Rejected",
  "type": "python",
  "instructions": "Write split_jsonl(src, good_path, bad_path, required). Read src line by line, skipping blank lines. A line is good if it parses as a JSON object containing every required key. Write good objects to good_path as JSON lines (json.dumps with sort_keys=True). Write bad lines to bad_path as JSON lines {'line': line_number (1-based), 'reason': 'invalid_json' | 'not_object' | 'missing:<key>', 'raw': stripped text}; for missing keys report the first missing key in required order. Return (good_count, bad_count).",
  "starter": "def split_jsonl(src: str, good_path: str, bad_path: str, required: list) -> tuple:\n    raise NotImplementedError\n",
  "solution": "import json\n\ndef split_jsonl(src: str, good_path: str, bad_path: str, required: list) -> tuple:\n    g = b = 0\n    with open(src) as f, open(good_path, 'w') as good, open(bad_path, 'w') as bad:\n        for n, line in enumerate(f, 1):\n            s = line.strip()\n            if not s:\n                continue\n            reason = None\n            try:\n                obj = json.loads(s)\n            except ValueError:\n                reason = 'invalid_json'\n            else:\n                if not isinstance(obj, dict):\n                    reason = 'not_object'\n                else:\n                    miss = [k for k in required if k not in obj]\n                    if miss:\n                        reason = 'missing:' + miss[0]\n            if reason:\n                bad.write(json.dumps({'line': n, 'reason': reason, 'raw': s}) + '\\n')\n                b += 1\n            else:\n                good.write(json.dumps(obj, sort_keys=True) + '\\n')\n                g += 1\n    return g, b\n",
  "tests": "import json\nopen('events.jsonl','w').write('{\"type\":\"view\",\"id\":1}\\n{bad\\n')\nassert split_jsonl('events.jsonl','good.jsonl','bad.jsonl',['id','type']) == (1, 1)\nassert open('good.jsonl').read() == '{\"id\": 1, \"type\": \"view\"}\\n'\nassert json.loads(open('bad.jsonl').read()) == {'line':2,'reason':'invalid_json','raw':'{bad'}\n",
  "hidden": "import json\nopen('e.jsonl','w').write('')\nassert split_jsonl('e.jsonl','g','b',['id']) == (0,0)\nopen('e.jsonl','w').write('\\n[1,2]\\n{\"type\":\"x\"}\\n\\n{\"id\":2}\\n')\nassert split_jsonl('e.jsonl','g','b',['id','type']) == (0,3)\nbad=[json.loads(l) for l in open('b')]\nassert [x['reason'] for x in bad] == ['not_object','missing:id','missing:type']\nassert [x['line'] for x in bad] == [2,3,5]\nopen('e.jsonl','w').write(''.join(json.dumps({'id':i})+'\\n' for i in range(5000)))\nassert split_jsonl('e.jsonl','g','b',['id']) == (5000,0)\n",
  "explanation": "Iterating the file object reads one line at a time, so memory stays constant. Each line goes through parse, shape and required-key checks, and the first failing check becomes its reason. Good and bad outputs are written as the scan proceeds, and enumerate starting at 1 gives line numbers that match an editor. Blank lines are skipped but still counted in numbering."
}
```
