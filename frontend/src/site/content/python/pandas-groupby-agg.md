---
id: PY-013
title: Revenue Summary with pandas groupby
slug: pandas-groupby-agg
difficulty: Medium
category: advanced
skill: aggregation
description: Aggregate order lines per category with named aggregations and a share-of-total column.
topic: python-pandas
concepts: pandas groupby, named aggregation, shares
time: O(n + g log g)
space: O(n)
minutes: 20
---

## Scenario

An e-commerce orders table has category, order id, quantity and price per line item. The category manager wants distinct orders, revenue and revenue share per category, largest first.

## Problem

Write `def category_summary(df: pd.DataFrame) -> pd.DataFrame` for columns `category, order_id, qty, price`.
Return one row per category with columns `category, orders` (distinct `order_id`s), `revenue` (sum of
`qty * price`), `share` (revenue / total revenue, rounded to 3 places). Sort by `revenue` descending, then
`category` ascending, with a fresh index. Empty input returns an empty frame with those columns.

## Objective

Return one row per category with distinct orders, revenue and rounded share, sorted by revenue desc then category.

## Input format

A DataFrame with category, order_id, qty and price.

## Output format

A DataFrame with category, orders, revenue and share.

## Constraints

- orders counts distinct order ids
- Sorted by revenue desc, then category

## Examples

```
category  order_id  qty  price
A         1         2    5.0      ->  category  orders  revenue  share
A         1         1    5.0          B         1       20.0     0.571
B         2         4    5.0          A         1       15.0     0.429
```

## Hints

- Add `revenue = qty * price` first, then `groupby('category').agg(orders=('order_id','nunique'), revenue=('revenue','sum'))`.
- `sort_values(['revenue','category'], ascending=[False, True])`.

## Why it matters

Named groupby aggregation is the pandas equivalent of SQL GROUP BY, and computing shares and distinct counts correctly is everyday reporting work.

```task
{
  "id": "pandas-groupby-agg",
  "title": "Revenue Summary with pandas groupby",
  "type": "python",
  "instructions": "Write `def category_summary(df: pd.DataFrame) -> pd.DataFrame` for columns `category, order_id, qty, price`.\nReturn one row per category with columns `category, orders` (distinct `order_id`s), `revenue` (sum of\n`qty * price`), `share` (revenue / total revenue, rounded to 3 places). Sort by `revenue` descending, then\n`category` ascending, with a fresh index. Empty input returns an empty frame with those columns.",
  "starter": "import pandas as pd\n\ndef category_summary(df: pd.DataFrame) -> pd.DataFrame:\n    raise NotImplementedError\n",
  "solution": "import pandas as pd\n\ndef category_summary(df: pd.DataFrame) -> pd.DataFrame:\n    cols = [\"category\", \"orders\", \"revenue\", \"share\"]\n    if df.empty:\n        return pd.DataFrame(columns=cols)\n    d = df.assign(revenue=df[\"qty\"] * df[\"price\"])\n    g = d.groupby(\"category\", as_index=False).agg(orders=(\"order_id\", \"nunique\"), revenue=(\"revenue\", \"sum\"))\n    g[\"share\"] = (g[\"revenue\"] / g[\"revenue\"].sum()).round(3)\n    return g.sort_values([\"revenue\", \"category\"], ascending=[False, True]).reset_index(drop=True)[cols]\n",
  "tests": "import pandas as pd\ndf = pd.DataFrame({\"category\": [\"A\", \"A\", \"B\", \"C\"], \"order_id\": [1, 1, 2, 3],\n                   \"qty\": [2, 1, 4, 3], \"price\": [5.0, 5.0, 5.0, 5.0]})\nr = category_summary(df)\nassert list(r.columns) == [\"category\", \"orders\", \"revenue\", \"share\"]\nassert list(r[\"category\"]) == [\"B\", \"A\", \"C\"]\nassert list(r[\"revenue\"]) == [20.0, 15.0, 15.0]\n",
  "hidden": "assert list(r[\"orders\"]) == [1, 1, 1]\nassert list(r[\"share\"]) == [0.4, 0.3, 0.3]\nassert list(r.index) == [0, 1, 2]\ne = category_summary(df.iloc[0:0])\nassert e.empty and list(e.columns) == [\"category\", \"orders\", \"revenue\", \"share\"]\n",
  "explanation": "Named aggregation computes distinct orders and total revenue in one groupby. Dividing by the grand total gives each category's share, and an explicit sort makes the output deterministic."
}
```
