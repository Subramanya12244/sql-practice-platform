---
id: PY-005
title: Flatten Nested JSON Records
slug: flatten-json-records
difficulty: Medium
category: processing
skill: transformation
description: Flatten nested JSON objects into dot-separated column names for loading into a table.
topic: python-csv-json
concepts: recursion, nested dicts, json.loads, key paths
time: O(n)
space: O(n)
minutes: 20
---

## Scenario

An orders API returns nested JSON objects with customer and shipping details inside each order. The warehouse table needs flat columns like 'customer.id' and 'shipping.city'.

## Problem

Write `def flatten(record: dict, sep: str = ".") -> dict` that flattens nested dicts so
`{"a": {"b": 1}}` becomes `{"a.b": 1}`. Lists and other values are kept as-is. An empty nested dict
disappears. Then write `def flatten_json(text: str) -> list` that parses a JSON array string and flattens each object.

## Objective

Flatten nested dicts into dotted keys, and parse a JSON array string into a list of flattened records.

## Input format

A nested dict (or JSON text of a list of them).

## Output format

A flat dict with joined key paths.

## Constraints

- Lists are kept as values
- Empty nested dicts disappear

## Examples

```
flatten({"id": 1, "user": {"name": "a", "geo": {"cc": "IN"}}, "tags": ["x"]})
  ->  {"id": 1, "user.name": "a", "user.geo.cc": "IN", "tags": ["x"]}
flatten_json('[{"a": {"b": null}}]')  ->  [{"a.b": None}]
```

## Hints

- Recurse when the value `isinstance(v, dict)`, passing the prefix down.
- `json.loads` turns `null` into `None`.

## Why it matters

Flattening semi-structured payloads into columns is a standard step when loading API data into relational tables.

```task
{
  "id": "flatten-json-records",
  "title": "Flatten Nested JSON Records",
  "type": "python",
  "instructions": "Write `def flatten(record: dict, sep: str = \".\") -> dict` that flattens nested dicts so\n`{\"a\": {\"b\": 1}}` becomes `{\"a.b\": 1}`. Lists and other values are kept as-is. An empty nested dict\ndisappears. Then write `def flatten_json(text: str) -> list` that parses a JSON array string and flattens each object.",
  "starter": "def flatten(record: dict, sep: str = \".\") -> dict:\n    raise NotImplementedError\n\ndef flatten_json(text: str) -> list:\n    raise NotImplementedError\n",
  "solution": "import json\n\ndef flatten(record: dict, sep: str = \".\") -> dict:\n    out = {}\n    def walk(obj, prefix):\n        for k, v in obj.items():\n            key = f\"{prefix}{sep}{k}\" if prefix else k\n            if isinstance(v, dict):\n                walk(v, key)\n            else:\n                out[key] = v\n    walk(record, \"\")\n    return out\n\ndef flatten_json(text: str) -> list:\n    return [flatten(r) for r in json.loads(text)]\n",
  "tests": "assert flatten({\"id\": 1, \"user\": {\"name\": \"a\", \"geo\": {\"cc\": \"IN\"}}, \"tags\": [\"x\"]}) == {\"id\": 1, \"user.name\": \"a\", \"user.geo.cc\": \"IN\", \"tags\": [\"x\"]}\nassert flatten({}) == {}\nassert flatten({\"a\": {}}) == {}\n",
  "hidden": "assert flatten({\"a\": {\"b\": 2}}, sep=\"__\") == {\"a__b\": 2}\nassert flatten_json('[{\"a\": {\"b\": null}}]') == [{\"a.b\": None}]\nassert flatten_json(\"[]\") == []\n",
  "explanation": "The walker recurses into dicts and records any other value under the path built so far, joined with `sep`. Lists are treated as leaf values because flattening them would need index-based keys."
}
```
