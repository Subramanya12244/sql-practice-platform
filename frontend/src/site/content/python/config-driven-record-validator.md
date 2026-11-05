---
id: PY-121
title: Config Driven Record Validator
slug: config-driven-record-validator
difficulty: Hard
category: advanced
skill: validation
description: Compile a declarative validation config into a fast validator function, rejecting bad configs at build time.
topic: python-functions
concepts: closures, rule compilation, regex, fail-fast configuration
time: O(fields + checks) per record
space: O(config)
minutes: 35
---

## Scenario

Each data feed owner wants to describe validation rules in config instead of code. The platform compiles those configs once at pipeline start and runs them on millions of employee and order records.

## Problem

Write `build_validator(config)` returning `validate(record) -> list[str]`. `config['fields']` maps field name to rules from: `required` (bool), `type` ('int', 'float', 'str'), `min`, `max`, `regex` (full match), `allowed` (collection). `config.get('checks', [])` holds cross-field checks `{'name': n, 'gte': [a, b]}` meaning record[a] >= record[b] when both are present and not None. At build time raise ValueError for unknown rules, unknown types or invalid regexes. Errors are strings 'field:rule' ('name:gte' for checks), in config field order then rule order required, type, min, max, regex, allowed, then checks in order. A missing or None field yields 'field:required' if required and is otherwise skipped. A type failure skips the remaining rules for that field. bool is not an int or float; int is a valid float.

## Objective

Turn declarative rules into a compiled validator with deterministic error output.

## Input format

A config dict; records as dicts.

## Output format

A callable returning a list of error codes.

## Constraints

- Bad config raises at build time, not per record
- Regex compiled once
- Deterministic error order

## Examples

```
v = build_validator({'fields': {'age': {'required': True, 'type': 'int', 'min': 18}}})
v({'age': 16})  ->  ['age:min']
v({})  ->  ['age:required']
```

## Hints

- Validate config keys against a set of allowed rule names before building anything.
- Pre-compile regexes with re.compile and catch re.error to raise ValueError.
- Build a list of (field, rules) closures and iterate them in order inside validate.

## Why it matters

Config-driven validation (like Great Expectations or pandera schemas) lets non-engineers own data quality rules. Compiling configs once and failing fast on bad configs keeps validation both fast and safe.

```task
{
  "id": "config-driven-record-validator",
  "title": "Config Driven Record Validator",
  "type": "python",
  "instructions": "Write `build_validator(config)` returning `validate(record) -> list[str]`. `config['fields']` maps field name to rules from: `required` (bool), `type` ('int', 'float', 'str'), `min`, `max`, `regex` (full match), `allowed` (collection). `config.get('checks', [])` holds cross-field checks `{'name': n, 'gte': [a, b]}` meaning record[a] >= record[b] when both are present and not None. At build time raise ValueError for unknown rules, unknown types or invalid regexes. Errors are strings 'field:rule' ('name:gte' for checks), in config field order then rule order required, type, min, max, regex, allowed, then checks in order. A missing or None field yields 'field:required' if required and is otherwise skipped. A type failure skips the remaining rules for that field. bool is not an int or float; int is a valid float.",
  "starter": "def build_validator(config: dict):\n    raise NotImplementedError\n",
  "solution": "import re\n\n_RULES = (\"required\", \"type\", \"min\", \"max\", \"regex\", \"allowed\")\n_TYPES = {\n    \"int\": lambda v: isinstance(v, int) and not isinstance(v, bool),\n    \"float\": lambda v: isinstance(v, (int, float)) and not isinstance(v, bool),\n    \"str\": lambda v: isinstance(v, str),\n}\n\n\ndef build_validator(config: dict):\n    fields = []\n    for name, rules in config.get(\"fields\", {}).items():\n        unknown = set(rules) - set(_RULES)\n        if unknown:\n            raise ValueError(f\"unknown rules {unknown} for {name}\")\n        if \"type\" in rules and rules[\"type\"] not in _TYPES:\n            raise ValueError(f\"unknown type {rules['type']}\")\n        r = dict(rules)\n        if \"regex\" in r:\n            try:\n                r[\"regex\"] = re.compile(r[\"regex\"])\n            except re.error as e:\n                raise ValueError(f\"bad regex for {name}\") from e\n        fields.append((name, r))\n    checks = []\n    for c in config.get(\"checks\", []):\n        if set(c) != {\"name\", \"gte\"} or len(c[\"gte\"]) != 2:\n            raise ValueError(f\"bad check {c}\")\n        checks.append((c[\"name\"], *c[\"gte\"]))\n\n    def validate(record):\n        errors = []\n        for name, r in fields:\n            v = record.get(name)\n            if v is None:\n                if r.get(\"required\"):\n                    errors.append(f\"{name}:required\")\n                continue\n            if \"type\" in r and not _TYPES[r[\"type\"]](v):\n                errors.append(f\"{name}:type\")\n                continue\n            if \"min\" in r and v < r[\"min\"]:\n                errors.append(f\"{name}:min\")\n            if \"max\" in r and v > r[\"max\"]:\n                errors.append(f\"{name}:max\")\n            if \"regex\" in r and not (isinstance(v, str) and r[\"regex\"].fullmatch(v)):\n                errors.append(f\"{name}:regex\")\n            if \"allowed\" in r and v not in r[\"allowed\"]:\n                errors.append(f\"{name}:allowed\")\n        for cname, a, b in checks:\n            x, y = record.get(a), record.get(b)\n            if x is not None and y is not None and not x >= y:\n                errors.append(f\"{cname}:gte\")\n        return errors\n    return validate\n",
  "tests": "v = build_validator({'fields': {'age': {'required': True, 'type': 'int', 'min': 18}}})\nassert v({'age': 16}) == ['age:min']\nassert v({}) == ['age:required']\nassert v({'age': 30}) == []\n",
  "hidden": "cfg = {'fields': {\n    'emp_id': {'required': True, 'type': 'str', 'regex': r'E\\d{4}'},\n    'salary': {'type': 'float', 'min': 0, 'max': 500000},\n    'dept': {'allowed': {'eng', 'ops'}},\n    'level': {'type': 'int', 'min': 1, 'max': 9}},\n 'checks': [{'name': 'dates', 'gte': ['end', 'start']}]}\nv = build_validator(cfg)\nassert v({'emp_id': 'E0001', 'salary': 1000, 'dept': 'eng', 'level': 3, 'start': '2024-01-01', 'end': '2024-02-01'}) == []\nassert v({'emp_id': 'E01', 'salary': -5.0, 'dept': 'hr', 'level': True, 'start': '2024-03-01', 'end': '2024-02-01'}) == ['emp_id:regex', 'salary:min', 'dept:allowed', 'level:type', 'dates:gte']\nassert v({'emp_id': None, 'salary': '10', 'level': 99, 'start': '2024-01-01'}) == ['emp_id:required', 'salary:type', 'level:max']\nassert v({'emp_id': 12345}) == ['emp_id:type']\ntry:\n    build_validator({'fields': {'a': {'requird': True}}})\n    raise AssertionError('expected ValueError')\nexcept ValueError:\n    pass\ntry:\n    build_validator({'fields': {'a': {'type': 'decimal'}}})\n    raise AssertionError('expected ValueError')\nexcept ValueError:\n    pass\ntry:\n    build_validator({'fields': {'a': {'regex': '('}}})\n    raise AssertionError('expected ValueError')\nexcept ValueError:\n    pass\nassert build_validator({})({'anything': 1}) == []\n",
  "explanation": "Building the validator once separates configuration errors from data errors: a typo in a rule name or a broken regex fails at pipeline start rather than on record one million. Regexes are compiled once and captured in a closure, so per-record work is just a few comparisons. Fixed iteration order over fields, rules and checks makes error lists deterministic and easy to aggregate. Stopping a field's checks after a type failure avoids confusing cascades such as comparing a string with a number. Treating bool separately from int closes a classic Python pitfall where True passes as 1."
}
```
