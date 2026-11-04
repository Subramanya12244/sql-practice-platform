---
title: pandas Merge and Anti-Join
slug: pandas-merge-anti-join
difficulty: Hard
description: Enrich orders with customer data and find orphan orders with a pandas anti-join.
topic: python-pandas
minutes: 25
---

## Problem

Write two functions over `orders(order_id, customer_id, amount)` and `customers(customer_id, name)`:
- `def enrich(orders, customers) -> pd.DataFrame`: left join adding `name`; missing names become `"UNKNOWN"`.
  Keep order row count and order (customers may contain duplicate `customer_id`s: keep the first).
- `def orphan_orders(orders, customers) -> pd.DataFrame`: orders whose `customer_id` is not in customers
  (a null `customer_id` counts as orphan). Return the original columns only, fresh index.

## Examples

```
orders: (1, 10, 5.0), (2, 99, 7.0)    customers: (10, "Ann")
enrich         ->  (1, 10, 5.0, "Ann"), (2, 99, 7.0, "UNKNOWN")
orphan_orders  ->  (2, 99, 7.0)
```

## Hints

- `customers.drop_duplicates('customer_id')` before merging prevents row fan-out.
- Anti-join: `merge(..., how='left', indicator=True)` then keep `_merge == 'left_only'`, or use `~isin`.

```task
{
  "id": "pandas-merge-anti-join",
  "title": "pandas Merge and Anti-Join",
  "type": "python",
  "instructions": "Write two functions over `orders(order_id, customer_id, amount)` and `customers(customer_id, name)`:\n- `def enrich(orders, customers) -> pd.DataFrame`: left join adding `name`; missing names become `\"UNKNOWN\"`.\n  Keep order row count and order (customers may contain duplicate `customer_id`s: keep the first).\n- `def orphan_orders(orders, customers) -> pd.DataFrame`: orders whose `customer_id` is not in customers\n  (a null `customer_id` counts as orphan). Return the original columns only, fresh index.",
  "starter": "import pandas as pd\n\ndef enrich(orders: pd.DataFrame, customers: pd.DataFrame) -> pd.DataFrame:\n    raise NotImplementedError\n\ndef orphan_orders(orders: pd.DataFrame, customers: pd.DataFrame) -> pd.DataFrame:\n    raise NotImplementedError\n",
  "solution": "import pandas as pd\n\ndef enrich(orders: pd.DataFrame, customers: pd.DataFrame) -> pd.DataFrame:\n    c = customers.drop_duplicates(\"customer_id\", keep=\"first\")[[\"customer_id\", \"name\"]]\n    out = orders.merge(c, on=\"customer_id\", how=\"left\")\n    out[\"name\"] = out[\"name\"].fillna(\"UNKNOWN\")\n    return out\n\ndef orphan_orders(orders: pd.DataFrame, customers: pd.DataFrame) -> pd.DataFrame:\n    c = customers[[\"customer_id\"]].drop_duplicates()\n    m = orders.merge(c, on=\"customer_id\", how=\"left\", indicator=True)\n    return m[m[\"_merge\"] == \"left_only\"][list(orders.columns)].reset_index(drop=True)\n",
  "tests": "import pandas as pd\norders = pd.DataFrame({\"order_id\": [1, 2, 3, 4], \"customer_id\": [10, 99, 10, None], \"amount\": [5.0, 7.0, 1.0, 2.0]})\ncustomers = pd.DataFrame({\"customer_id\": [10, 10, 20], \"name\": [\"Ann\", \"Dup\", \"Bob\"]})\ne = enrich(orders, customers)\nassert len(e) == 4\nassert list(e[\"order_id\"]) == [1, 2, 3, 4]\nassert list(e[\"name\"]) == [\"Ann\", \"UNKNOWN\", \"Ann\", \"UNKNOWN\"]\no = orphan_orders(orders, customers)\nassert list(o.columns) == [\"order_id\", \"customer_id\", \"amount\"]\nassert list(o[\"order_id\"]) == [2, 4]\nassert list(o.index) == [0, 1]\nnone = orphan_orders(orders.iloc[[0, 2]], customers)\nassert none.empty\n"
}
```
