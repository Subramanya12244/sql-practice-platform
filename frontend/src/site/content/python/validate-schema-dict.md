---
id: PY-112
title: Validate Records Against A Schema Spec
slug: validate-schema-dict
difficulty: Medium
category: processing
skill: validation
description: Check records against a schema of types, required flags and allowed values.
topic: python-collections
concepts: schema dict, type checks, required/allowed
time: O(n*f)
space: O(n)
minutes: 20
---

## Scenario

A partner API pushes customer signups. Before loading, each record must match an agreed schema or be rejected with reasons.

## Problem

Write validate(records, schema). schema maps field -> {'type': python type, 'required': bool, 'allowed': optional list}. For each record return errors as strings: 'missing:<f>' for required fields absent or None, 'type:<f>' when present but wrong type (bool is never an int), 'value:<f>' when not in allowed, 'extra:<f>' for fields not in schema. Return (valid_records, {index: sorted errors}).

## Objective

Implement a small declarative schema validator.

## Input format

records: list of dicts; schema: dict.

## Output format

tuple (list, dict).

## Constraints

- Optional fields may be absent or None
- A field gets at most one error

## Examples

```
schema={'id':{'type':int,'required':True},'plan':{'type':str,'required':False,'allowed':['free','pro']}}
validate([{'id':1,'plan':'pro'},{'plan':'gold','x':1}], schema)  ->  ([{'id':1,'plan':'pro'}], {1:['extra:x','missing:id','value:plan']})
```

## Hints

- Check missing first, then type, then allowed.
- Extra fields are keys of the record not in the schema.

## Why it matters

Schema enforcement at the boundary is how data contracts are applied. Collecting typed error codes lets you report and quarantine bad rows.

```task
{
  "id": "validate-schema-dict",
  "title": "Validate Records Against A Schema Spec",
  "type": "python",
  "instructions": "Write validate(records, schema). schema maps field -> {'type': python type, 'required': bool, 'allowed': optional list}. For each record return errors as strings: 'missing:<f>' for required fields absent or None, 'type:<f>' when present but wrong type (bool is never an int), 'value:<f>' when not in allowed, 'extra:<f>' for fields not in schema. Return (valid_records, {index: sorted errors}).",
  "starter": "def validate(records: list, schema: dict) -> tuple:\n    raise NotImplementedError\n",
  "solution": "def validate(records: list, schema: dict) -> tuple:\n    good, errors = [], {}\n    for i, r in enumerate(records):\n        errs = [f'extra:{k}' for k in r if k not in schema]\n        for f, spec in schema.items():\n            v = r.get(f)\n            if v is None:\n                if spec.get('required'):\n                    errs.append(f'missing:{f}')\n                continue\n            t = spec['type']\n            if not isinstance(v, t) or (isinstance(v, bool) and t is not bool):\n                errs.append(f'type:{f}')\n            elif 'allowed' in spec and v not in spec['allowed']:\n                errs.append(f'value:{f}')\n        if errs:\n            errors[i] = sorted(errs)\n        else:\n            good.append(r)\n    return good, errors\n",
  "tests": "schema={'id':{'type':int,'required':True},'plan':{'type':str,'required':False,'allowed':['free','pro']}}\nassert validate([{'id':1,'plan':'pro'},{'plan':'gold','x':1}], schema) == ([{'id':1,'plan':'pro'}], {1:['extra:x','missing:id','value:plan']})\nassert validate([{'id':'7'}], schema) == ([], {0:['type:id']})\n",
  "hidden": "schema={'id':{'type':int,'required':True},'plan':{'type':str,'required':False,'allowed':['free','pro']}}\nassert validate([], schema) == ([], {})\nassert validate([{'id':True}], schema) == ([], {0:['type:id']})\nassert validate([{'id':2,'plan':None}], schema) == ([{'id':2,'plan':None}], {})\nassert validate([{'id':None}], schema) == ([], {0:['missing:id']})\nassert validate([{'id':1,'plan':5}], schema) == ([], {0:['type:plan']})\nassert validate([{'a':1}], {'a':{'type':float,'required':True}}) == ([], {0:['type:a']})\n",
  "explanation": "Each field passes through ordered checks, and the first failure is recorded so a field gets one error. Treating None like absent lets optional fields be null. The explicit bool test stops True from passing as an int. Extra keys are detected by membership in the schema, and errors are sorted so reports are stable."
}
```
