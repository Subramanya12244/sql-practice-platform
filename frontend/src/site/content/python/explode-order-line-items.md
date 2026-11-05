---
id: PY-076
title: Explode Nested Order JSON Into Line Rows
slug: explode-order-line-items
difficulty: Medium
category: processing
skill: transformation
description: Turn a JSON array of orders with nested customer and items into flat line rows.
topic: python-csv-json
concepts: nested JSON, flattening arrays, json.loads
time: O(n)
space: O(n)
minutes: 15
---

## Scenario

An e-commerce API returns orders with a nested customer object and an items array. The warehouse fact table wants one row per line item.

## Problem

Write explode_orders(payload) where payload is a JSON string of a list of orders: {'id', 'customer': {'id', 'country'}, 'items': [{'sku','qty','price'}]}. Return one dict per item: {'order_id','customer_id','country','sku','qty','line_total'} with line_total = round(qty*price, 2). Orders with no or empty items produce no rows. A missing customer gives None for customer fields.

## Objective

Flatten one-to-many nested JSON into tabular rows.

## Input format

JSON string.

## Output format

list of dicts.

## Constraints

- Keep input order

## Examples

```
'[{"id":1,"customer":{"id":"c1","country":"DE"},"items":[{"sku":"A","qty":2,"price":1.5}]}]'
->  [{'order_id':1,'customer_id':'c1','country':'DE','sku':'A','qty':2,'line_total':3.0}]
```

## Hints

- Use (order.get('customer') or {}) to tolerate null objects.
- Loop orders, then items, appending a row each time.

## Why it matters

Exploding nested arrays is one of the most common JSON-to-table steps in ingestion. Handling missing nested objects avoids KeyError crashes on real API data.

```task
{
  "id": "explode-order-line-items",
  "title": "Explode Nested Order JSON Into Line Rows",
  "type": "python",
  "instructions": "Write explode_orders(payload) where payload is a JSON string of a list of orders: {'id', 'customer': {'id', 'country'}, 'items': [{'sku','qty','price'}]}. Return one dict per item: {'order_id','customer_id','country','sku','qty','line_total'} with line_total = round(qty*price, 2). Orders with no or empty items produce no rows. A missing customer gives None for customer fields.",
  "starter": "def explode_orders(payload: str) -> list:\n    raise NotImplementedError\n",
  "solution": "import json\n\ndef explode_orders(payload: str) -> list:\n    rows = []\n    for o in json.loads(payload):\n        c = o.get('customer') or {}\n        for it in o.get('items') or []:\n            rows.append({'order_id': o.get('id'), 'customer_id': c.get('id'), 'country': c.get('country'),\n                         'sku': it.get('sku'), 'qty': it.get('qty'), 'line_total': round(it['qty'] * it['price'], 2)})\n    return rows\n",
  "tests": "p='[{\"id\":1,\"customer\":{\"id\":\"c1\",\"country\":\"DE\"},\"items\":[{\"sku\":\"A\",\"qty\":2,\"price\":1.5}]}]'\nassert explode_orders(p) == [{'order_id':1,'customer_id':'c1','country':'DE','sku':'A','qty':2,'line_total':3.0}]\nassert explode_orders('[{\"id\":2,\"customer\":{\"id\":\"c2\"},\"items\":[]}]') == []\n",
  "hidden": "assert explode_orders('[]') == []\nassert explode_orders('[{\"id\":3,\"customer\":null,\"items\":[{\"sku\":\"B\",\"qty\":1,\"price\":0.1}]}]') == [{'order_id':3,'customer_id':None,'country':None,'sku':'B','qty':1,'line_total':0.1}]\nassert explode_orders('[{\"id\":4}]') == []\nimport json\nbig=json.dumps([{'id':i,'customer':{'id':'c','country':'US'},'items':[{'sku':'S','qty':1,'price':2}]*3} for i in range(500)])\nr=explode_orders(big)\nassert len(r)==1500 and r[-1]['order_id']==499\n",
  "explanation": "json.loads gives Python structures, and the outer loop emits a row per nested item, which is the explode operation. The 'or {}' and 'or []' idioms cover missing and null values in one step. Parent fields are copied onto every child row, producing a denormalised fact table."
}
```
