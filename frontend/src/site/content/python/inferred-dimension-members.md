---
id: PY-133
title: Late Arriving Dimensions With Inferred Members
slug: inferred-dimension-members
difficulty: Hard
category: processing
skill: incremental
description: Load facts whose customer has not arrived yet by creating inferred dimension rows that are completed later.
topic: python-oop
concepts: surrogate keys, inferred members, late-arriving data, idempotency
time: O(1) per row
space: O(customers + orders)
minutes: 35
---

## Scenario

Orders stream in from the shop within seconds, but new customers are synced from the CRM only every hour. The warehouse must never drop or block an order just because its customer row is late.

## Problem

Implement class `StarLoader`. `load_customers(rows)` takes dicts with `customer_id`, `name`, `tier`. A new customer_id gets the next surrogate key (1, 2, 3...); a known one keeps its key, gets its attributes overwritten and `inferred` set to False. `load_orders(rows)` takes dicts with `order_id`, `customer_id`, `amount`. If the customer is unknown, create an inferred member (next key, name and tier None, inferred True) and use its key. Re-loading an order_id that already exists is ignored (idempotent). `dim(customer_id)` returns the dimension row as `{'key', 'customer_id', 'name', 'tier', 'inferred'}` or None, and `facts()` returns `(order_id, customer_key, amount)` tuples sorted by order_id. `inferred_count()` returns how many dimension rows are still inferred.

## Objective

Model the Kimball inferred-member pattern for late-arriving dimensions.

## Input format

Batches of customer and order dicts.

## Output format

Dimension rows, fact tuples and a count.

## Constraints

- Surrogate keys never change once assigned
- Duplicate order_ids ignored
- Customer rows may arrive before or after their orders

## Examples

```
s = StarLoader(); s.load_orders([{'order_id': 'o1', 'customer_id': 'c9', 'amount': 20}])
s.dim('c9')  ->  {'key': 1, 'customer_id': 'c9', 'name': None, 'tier': None, 'inferred': True}
s.load_customers([{'customer_id': 'c9', 'name': 'Ana', 'tier': 'gold'}]); s.dim('c9')['inferred']  ->  False
```

## Hints

- Keep a dict customer_id -> row and a counter for the next key.
- load_orders calls a helper that returns the key, creating an inferred row if needed.
- Completing an inferred row updates it in place so fact keys stay valid.

## Why it matters

Late-arriving dimensions are one of the most common sources of missing rows in star schemas. Inferred members keep facts complete and let the dimension catch up without rewriting fact keys.

```task
{
  "id": "inferred-dimension-members",
  "title": "Late Arriving Dimensions With Inferred Members",
  "type": "python",
  "instructions": "Implement class `StarLoader`. `load_customers(rows)` takes dicts with `customer_id`, `name`, `tier`. A new customer_id gets the next surrogate key (1, 2, 3...); a known one keeps its key, gets its attributes overwritten and `inferred` set to False. `load_orders(rows)` takes dicts with `order_id`, `customer_id`, `amount`. If the customer is unknown, create an inferred member (next key, name and tier None, inferred True) and use its key. Re-loading an order_id that already exists is ignored (idempotent). `dim(customer_id)` returns the dimension row as `{'key', 'customer_id', 'name', 'tier', 'inferred'}` or None, and `facts()` returns `(order_id, customer_key, amount)` tuples sorted by order_id. `inferred_count()` returns how many dimension rows are still inferred.",
  "starter": "class StarLoader:\n    def __init__(self):\n        raise NotImplementedError\n",
  "solution": "class StarLoader:\n    def __init__(self):\n        self._dim = {}\n        self._facts = {}\n        self._next = 1\n\n    def _key_for(self, cid):\n        row = self._dim.get(cid)\n        if row is None:\n            row = {\"key\": self._next, \"customer_id\": cid, \"name\": None, \"tier\": None, \"inferred\": True}\n            self._dim[cid] = row\n            self._next += 1\n        return row[\"key\"]\n\n    def load_customers(self, rows):\n        for r in rows:\n            self._key_for(r[\"customer_id\"])\n            self._dim[r[\"customer_id\"]].update(name=r[\"name\"], tier=r[\"tier\"], inferred=False)\n\n    def load_orders(self, rows):\n        for r in rows:\n            if r[\"order_id\"] in self._facts:\n                continue\n            self._facts[r[\"order_id\"]] = (r[\"order_id\"], self._key_for(r[\"customer_id\"]), r[\"amount\"])\n\n    def dim(self, customer_id):\n        row = self._dim.get(customer_id)\n        return dict(row) if row else None\n\n    def facts(self):\n        return sorted(self._facts.values())\n\n    def inferred_count(self):\n        return sum(r[\"inferred\"] for r in self._dim.values())\n",
  "tests": "s = StarLoader()\ns.load_orders([{'order_id': 'o1', 'customer_id': 'c9', 'amount': 20}])\nassert s.dim('c9') == {'key': 1, 'customer_id': 'c9', 'name': None, 'tier': None, 'inferred': True}\ns.load_customers([{'customer_id': 'c9', 'name': 'Ana', 'tier': 'gold'}])\nassert s.dim('c9') == {'key': 1, 'customer_id': 'c9', 'name': 'Ana', 'tier': 'gold', 'inferred': False}\nassert s.facts() == [('o1', 1, 20)]\n",
  "hidden": "s = StarLoader()\ns.load_customers([{'customer_id': 'a', 'name': 'A', 'tier': 'x'}])\ns.load_orders([{'order_id': 'o2', 'customer_id': 'b', 'amount': 5}, {'order_id': 'o1', 'customer_id': 'a', 'amount': 7}])\nassert s.facts() == [('o1', 1, 7), ('o2', 2, 5)]\nassert s.inferred_count() == 1\ns.load_orders([{'order_id': 'o2', 'customer_id': 'zzz', 'amount': 999}])\nassert s.facts() == [('o1', 1, 7), ('o2', 2, 5)] and s.dim('zzz') is None\ns.load_customers([{'customer_id': 'b', 'name': 'B', 'tier': 'y'}, {'customer_id': 'a', 'name': 'A2', 'tier': 'z'}])\nassert s.inferred_count() == 0 and s.dim('a')['key'] == 1 and s.dim('a')['name'] == 'A2' and s.dim('b')['key'] == 2\nassert s.dim('nope') is None\nd = s.dim('a'); d['name'] = 'hacked'\nassert s.dim('a')['name'] == 'A2'\nt = StarLoader()\nt.load_orders([{'order_id': f'o{i}', 'customer_id': f'c{i % 10}', 'amount': i} for i in range(100)])\nassert t.inferred_count() == 10 and len(t.facts()) == 100\n",
  "explanation": "An inferred member is a placeholder dimension row created the moment a fact references an unknown business key. Because the surrogate key is assigned immediately, the fact can be written with a valid foreign key instead of being dropped or parked. When the real customer arrives, the same row is updated in place and the inferred flag cleared, so no fact rows need rewriting. Keeping facts in a dict keyed by order_id makes reloads idempotent. Returning copies from dim() protects internal state from callers."
}
```
