---
id: PY-147
title: Stream CSV With A Quarantine File
slug: csv-quarantine-splitter
difficulty: Hard
category: files
skill: validation
description: Validate a large CSV row by row, writing clean rows to one file and rejects with reasons to a quarantine file.
topic: python-csv-json
concepts: csv module, streaming, context managers, schema validation, JSON lines
time: O(rows)
space: O(1) beyond one row
minutes: 35
---

## Scenario

A supplier drops a multi-gigabyte product feed every night and a few hundred rows are always broken. The load must not fail on bad rows, and the data steward needs a quarantine file to send back to the supplier.

## Problem

Write `split_valid_rows(src, good_path, bad_path, schema)`. `schema` is an ordered dict of column name to type name ('int', 'float' or 'str'); 'str' values must be non-empty after stripping. Read `src` with the csv module one row at a time. The header must equal the schema columns in order, otherwise raise ValueError before writing anything. Write valid rows (as original strings) with the header to `good_path`. For each invalid row write one JSON line to `bad_path`: `{"line": n, "reason": r, "row": fields}` where n is the 1-based physical line number from the reader, and r is 'field_count' for the wrong number of fields or 'bad_<column>' for the first failing column. Skip completely blank lines. Return `{'good': g, 'bad': b}`.

## Objective

Implement a streaming validator that never loses a record: every row goes to exactly one output.

## Input format

Three file paths and a schema dict.

## Output format

A dict of counts and two files on disk.

## Constraints

- Do not load the whole file
- Every non-blank row lands in exactly one output
- Use with-statements for all files

## Examples

```
src: 'sku,qty,price\nA1,3,9.5\nA2,x,1.0\n'
split_valid_rows('in.csv', 'good.csv', 'bad.jsonl', {'sku': 'str', 'qty': 'int', 'price': 'float'})  ->  {'good': 1, 'bad': 1}
bad.jsonl: {"line": 3, "reason": "bad_qty", "row": ["A2", "x", "1.0"]}
```

## Hints

- Open all three files in one with-statement; csv.reader(f) yields lists and exposes reader.line_num.
- Validate the header with next(reader) before opening the outputs, or check it first and then write.
- A small dict of converters {'int': int, 'float': float} plus a str check keeps validation table-driven.

## Why it matters

Quarantine files are how production pipelines stay up when inputs are dirty while still keeping every rejected record auditable. Streaming with the csv module keeps memory flat for very large feeds.

```task
{
  "id": "csv-quarantine-splitter",
  "title": "Stream CSV With A Quarantine File",
  "type": "python",
  "instructions": "Write `split_valid_rows(src, good_path, bad_path, schema)`. `schema` is an ordered dict of column name to type name ('int', 'float' or 'str'); 'str' values must be non-empty after stripping. Read `src` with the csv module one row at a time. The header must equal the schema columns in order, otherwise raise ValueError before writing anything. Write valid rows (as original strings) with the header to `good_path`. For each invalid row write one JSON line to `bad_path`: `{\"line\": n, \"reason\": r, \"row\": fields}` where n is the 1-based physical line number from the reader, and r is 'field_count' for the wrong number of fields or 'bad_<column>' for the first failing column. Skip completely blank lines. Return `{'good': g, 'bad': b}`.",
  "starter": "def split_valid_rows(src: str, good_path: str, bad_path: str, schema: dict) -> dict:\n    raise NotImplementedError\n",
  "solution": "import csv\nimport json\n\n\ndef _ok(kind, value):\n    if kind == \"str\":\n        return value.strip() != \"\"\n    try:\n        {\"int\": int, \"float\": float}[kind](value)\n        return True\n    except ValueError:\n        return False\n\n\ndef split_valid_rows(src: str, good_path: str, bad_path: str, schema: dict) -> dict:\n    cols = list(schema)\n    counts = {\"good\": 0, \"bad\": 0}\n    with open(src, newline=\"\") as f:\n        reader = csv.reader(f)\n        header = next(reader, None)\n        if header != cols:\n            raise ValueError(f\"unexpected header {header}\")\n        with open(good_path, \"w\", newline=\"\") as g, open(bad_path, \"w\") as b:\n            w = csv.writer(g)\n            w.writerow(cols)\n            for row in reader:\n                if not row:\n                    continue\n                reason = None\n                if len(row) != len(cols):\n                    reason = \"field_count\"\n                else:\n                    for c, v in zip(cols, row):\n                        if not _ok(schema[c], v):\n                            reason = f\"bad_{c}\"\n                            break\n                if reason:\n                    b.write(json.dumps({\"line\": reader.line_num, \"reason\": reason, \"row\": row}) + \"\\n\")\n                    counts[\"bad\"] += 1\n                else:\n                    w.writerow(row)\n                    counts[\"good\"] += 1\n    return counts\n",
  "tests": "import json\nopen('in.csv', 'w').write('sku,qty,price\\nA1,3,9.5\\nA2,x,1.0\\n')\nassert split_valid_rows('in.csv', 'good.csv', 'bad.jsonl', {'sku': 'str', 'qty': 'int', 'price': 'float'}) == {'good': 1, 'bad': 1}\nassert open('good.csv').read().splitlines() == ['sku,qty,price', 'A1,3,9.5']\nassert [json.loads(l) for l in open('bad.jsonl')] == [{'line': 3, 'reason': 'bad_qty', 'row': ['A2', 'x', '1.0']}]\n",
  "hidden": "import json, os\nS = {'sku': 'str', 'qty': 'int', 'price': 'float'}\nopen('a.csv', 'w').write('sku,qty,price\\n\"B,1\",2,3.0\\n\\n , 1, 2\\nC,1\\nD,1,2,3\\nE,4,abc\\n')\nassert split_valid_rows('a.csv', 'g.csv', 'b.jsonl', S) == {'good': 1, 'bad': 4}\nbad = [json.loads(l) for l in open('b.jsonl')]\nassert [(x['line'], x['reason']) for x in bad] == [(4, 'bad_sku'), (5, 'field_count'), (6, 'field_count'), (7, 'bad_price')]\nassert open('g.csv').read().splitlines()[1] == '\"B,1\",2,3.0'\nopen('h.csv', 'w').write('qty,sku,price\\n1,a,2\\n')\ntry:\n    split_valid_rows('h.csv', 'g2.csv', 'b2.jsonl', S)\n    raise AssertionError('expected ValueError')\nexcept ValueError:\n    pass\nassert not os.path.exists('g2.csv')\nopen('e.csv', 'w').write('sku,qty,price\\n')\nassert split_valid_rows('e.csv', 'g3.csv', 'b3.jsonl', S) == {'good': 0, 'bad': 0}\nopen('big.csv', 'w').write('sku,qty,price\\n' + ''.join(f'S{i},{i if i % 10 else \"?\"},1.5\\n' for i in range(5000)))\nassert split_valid_rows('big.csv', 'g4.csv', 'b4.jsonl', S) == {'good': 4500, 'bad': 500}\n",
  "explanation": "The csv module handles quoted commas, so a field like \"B,1\" stays one value, which naive split(',') gets wrong. Checking the header before opening the outputs fails fast on a changed feed layout without leaving half-written files. Each row is validated against a table of converters and routed to exactly one destination, so good plus bad always equals the input rows. reader.line_num gives the physical line, which the supplier can use to find the problem. Nested with-statements guarantee all handles are closed even when an exception escapes."
}
```
