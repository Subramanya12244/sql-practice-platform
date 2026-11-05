---
id: PY-098
title: Parse XML Orders Into Order Totals
slug: parse-xml-orders-totals
difficulty: Medium
category: files
skill: parsing
description: Read an XML orders export and compute a total per order.
topic: python-file-handling
concepts: xml.etree.ElementTree, attributes, nested elements
time: O(n)
space: O(n)
minutes: 15
---

## Scenario

A legacy ERP exports orders as XML. The new warehouse loader needs one row per order with its total and item count.

## Problem

Write parse_orders(xml_text). Structure: <orders><order id='..' customer='..'><item sku='..' qty='..' price='..'/>...</order></orders>. Return a list of {'id','customer','items','total'} in document order, total rounded to 2. Items with a non-numeric qty or price are skipped. A missing customer attribute gives None.

## Objective

Navigate XML elements and attributes and aggregate nested values.

## Input format

XML string.

## Output format

list of dicts.

## Constraints

- Use xml.etree.ElementTree

## Examples

```
<orders><order id='1' customer='c1'><item sku='A' qty='2' price='1.5'/></order></orders>
->  [{'id':'1','customer':'c1','items':1,'total':3.0}]
```

## Hints

- ET.fromstring(...).findall('order') then order.findall('item').
- Use .get('qty') and convert inside try/except.

## Why it matters

XML is still common in ERP, banking and B2B feeds. Parsing it safely with ElementTree and skipping bad items is a real ingestion skill.

```task
{
  "id": "parse-xml-orders-totals",
  "title": "Parse XML Orders Into Order Totals",
  "type": "python",
  "instructions": "Write parse_orders(xml_text). Structure: <orders><order id='..' customer='..'><item sku='..' qty='..' price='..'/>...</order></orders>. Return a list of {'id','customer','items','total'} in document order, total rounded to 2. Items with a non-numeric qty or price are skipped. A missing customer attribute gives None.",
  "starter": "def parse_orders(xml_text: str) -> list:\n    raise NotImplementedError\n",
  "solution": "import xml.etree.ElementTree as ET\n\ndef parse_orders(xml_text: str) -> list:\n    out = []\n    for o in ET.fromstring(xml_text).findall('order'):\n        n, total = 0, 0.0\n        for it in o.findall('item'):\n            try:\n                q, p = int(it.get('qty')), float(it.get('price'))\n            except (TypeError, ValueError):\n                continue\n            n += 1\n            total += q * p\n        out.append({'id': o.get('id'), 'customer': o.get('customer'), 'items': n, 'total': round(total, 2)})\n    return out\n",
  "tests": "assert parse_orders(\"<orders><order id='1' customer='c1'><item sku='A' qty='2' price='1.5'/></order></orders>\") == [{'id':'1','customer':'c1','items':1,'total':3.0}]\nassert parse_orders(\"<orders><order id='2'><item qty='x' price='1'/><item qty='1' price='0.5'/></order></orders>\") == [{'id':'2','customer':None,'items':1,'total':0.5}]\n",
  "hidden": "assert parse_orders('<orders/>') == []\nassert parse_orders(\"<orders><order id='3'/></orders>\") == [{'id':'3','customer':None,'items':0,'total':0}]\nassert parse_orders(\"<orders><order id='4'><item qty='1'/></order></orders>\")[0]['items'] == 0\nx='<orders>'+''.join(f\"<order id='{i}'><item qty='1' price='2'/><item qty='2' price='1'/></order>\" for i in range(500))+'</orders>'\nr=parse_orders(x)\nassert len(r)==500 and r[-1]=={'id':'499','customer':None,'items':2,'total':4.0}\n",
  "explanation": "ElementTree parses the whole document, and findall walks direct children in document order. Attributes come back as strings or None, so conversions are wrapped in try and catch both TypeError for missing and ValueError for junk. Totals accumulate per order and are rounded once at the end."
}
```
