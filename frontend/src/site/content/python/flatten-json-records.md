---
title: Flatten Nested JSON Records
slug: flatten-json-records
difficulty: Medium
description: Flatten nested JSON objects into dot-separated column names for loading into a table.
topic: python-csv-json
minutes: 20
---

## Problem

Write `def flatten(record: dict, sep: str = ".") -> dict` that flattens nested dicts so
`{"a": {"b": 1}}` becomes `{"a.b": 1}`. Lists and other values are kept as-is. An empty nested dict
disappears. Then write `def flatten_json(text: str) -> list` that parses a JSON array string and flattens each object.

## Examples

```
flatten({"id": 1, "user": {"name": "a", "geo": {"cc": "IN"}}, "tags": ["x"]})
  ->  {"id": 1, "user.name": "a", "user.geo.cc": "IN", "tags": ["x"]}
flatten_json('[{"a": {"b": null}}]')  ->  [{"a.b": None}]
```

## Hints

- Recurse when the value `isinstance(v, dict)`, passing the prefix down.
- `json.loads` turns `null` into `None`.

```task
{
  "id": "flatten-json-records",
  "title": "Flatten Nested JSON Records",
  "type": "python",
  "instructions": "Write `def flatten(record: dict, sep: str = \".\") -> dict` that flattens nested dicts so\n`{\"a\": {\"b\": 1}}` becomes `{\"a.b\": 1}`. Lists and other values are kept as-is. An empty nested dict\ndisappears. Then write `def flatten_json(text: str) -> list` that parses a JSON array string and flattens each object.",
  "starter": "def flatten(record: dict, sep: str = \".\") -> dict:\n    raise NotImplementedError\n\ndef flatten_json(text: str) -> list:\n    raise NotImplementedError\n",
  "solution": "import json\n\ndef flatten(record: dict, sep: str = \".\") -> dict:\n    out = {}\n    def walk(obj, prefix):\n        for k, v in obj.items():\n            key = f\"{prefix}{sep}{k}\" if prefix else k\n            if isinstance(v, dict):\n                walk(v, key)\n            else:\n                out[key] = v\n    walk(record, \"\")\n    return out\n\ndef flatten_json(text: str) -> list:\n    return [flatten(r) for r in json.loads(text)]\n",
  "tests": "assert flatten({\"id\": 1, \"user\": {\"name\": \"a\", \"geo\": {\"cc\": \"IN\"}}, \"tags\": [\"x\"]}) == {\"id\": 1, \"user.name\": \"a\", \"user.geo.cc\": \"IN\", \"tags\": [\"x\"]}\nassert flatten({}) == {}\nassert flatten({\"a\": {}}) == {}\nassert flatten({\"a\": {\"b\": 2}}, sep=\"__\") == {\"a__b\": 2}\nassert flatten_json('[{\"a\": {\"b\": null}}]') == [{\"a.b\": None}]\nassert flatten_json(\"[]\") == []\n"
}
```
