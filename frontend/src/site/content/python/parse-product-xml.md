---
id: PY-050
title: Parse Product XML
slug: parse-product-xml
difficulty: Easy
category: files
skill: parsing
description: Turn a supplier's XML product feed into dicts.
topic: python-file-handling
concepts: xml.etree.ElementTree, findall, attributes
time: O(n)
space: O(n)
minutes: 8
---

## Scenario

A supplier still sends its catalog as XML. The ingestion job converts it into records for the products table.

## Problem

Write `parse_products(xml_text)` returning a list of dicts {'sku', 'name', 'price'} for each <product> element. sku is the 'sku' attribute, name the <name> text, price the <price> text as float (None if missing or invalid).

## Objective

Turn each product element in the XML feed into a dict with its sku, name and float price.

## Input format

An XML string with a root containing <product> elements.

## Output format

A list of dicts.

## Constraints

- Use xml.etree.ElementTree

## Examples

```
parse_products('<c><product sku="A1"><name>Pen</name><price>1.5</price></product></c>')  ->  [{'sku': 'A1', 'name': 'Pen', 'price': 1.5}]
```

## Hints

- ET.fromstring gives the root; root.findall('product') gives items.
- Use findtext for child text with a default.

## Why it matters

XML feeds are still common from suppliers and legacy systems. ElementTree is the standard tool to flatten them into rows.

```task
{
  "id": "parse-product-xml",
  "title": "Parse Product XML",
  "type": "python",
  "instructions": "Write `parse_products(xml_text)` returning a list of dicts {'sku', 'name', 'price'} for each <product> element. sku is the 'sku' attribute, name the <name> text, price the <price> text as float (None if missing or invalid).",
  "starter": "def parse_products(xml_text):\n    raise NotImplementedError\n",
  "solution": "import xml.etree.ElementTree as ET\n\ndef parse_products(xml_text):\n    out = []\n    for p in ET.fromstring(xml_text).findall('product'):\n        try:\n            price = float(p.findtext('price'))\n        except (TypeError, ValueError):\n            price = None\n        out.append({'sku': p.get('sku'), 'name': p.findtext('name'), 'price': price})\n    return out\n",
  "tests": "assert parse_products('<c><product sku=\"A1\"><name>Pen</name><price>1.5</price></product></c>') == [{'sku': 'A1', 'name': 'Pen', 'price': 1.5}]\n",
  "hidden": "assert parse_products('<c></c>') == []\nassert parse_products('<c><product sku=\"B\"><name>Ink</name></product></c>') == [{'sku': 'B', 'name': 'Ink', 'price': None}]\nassert parse_products('<c><product><price>x</price></product></c>') == [{'sku': None, 'name': None, 'price': None}]\nx = '<c>' + ''.join(f'<product sku=\"{i}\"><price>{i}</price></product>' for i in range(300)) + '</c>'\nassert len(parse_products(x)) == 300\n",
  "explanation": "fromstring builds the tree and findall walks each product. findtext and get return None for missing parts, and the price cast is guarded by try."
}
```
