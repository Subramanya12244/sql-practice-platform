---
slug: sql-vs-pandas
title: SQL vs Pandas: Equivalent Operations Side by Side
description: SQL vs pandas compared: SELECT, WHERE, GROUP BY, JOIN, window functions and pivots translated line by line, with Northwind examples and when to use each.
keywords: sql vs pandas, pandas to sql, sql equivalent in pandas, groupby vs group by, pandas merge vs sql join, pandas window functions
questions: 1, 25, 98, 101, 131, 105
related: group-by-having, left-join, window-functions, pivot-rows-to-columns, sql-order-of-execution
---

SQL and pandas solve the same problems: filter rows, combine tables, aggregate and reshape. SQL describes the result and lets the database plan the work close to the data; pandas runs step by step in memory in Python. Most data interviews expect you to move between the two, so this guide maps the common operations one to one.

## Syntax

| Task | SQL | pandas |
|---|---|---|
| Select columns | `SELECT a, b FROM t` | `df[["a", "b"]]` |
| Filter | `WHERE a > 5` | `df[df.a > 5]` or `df.query("a > 5")` |
| Sort | `ORDER BY a DESC` | `df.sort_values("a", ascending=False)` |
| Limit | `LIMIT 10` | `df.head(10)` |
| Distinct | `SELECT DISTINCT a` | `df["a"].drop_duplicates()` |
| Aggregate | `GROUP BY k` + `SUM(v)` | `df.groupby("k")["v"].sum()` |
| Filter groups | `HAVING COUNT(*) > 5` | `.filter(lambda g: len(g) > 5)` or filter after `agg` |
| Join | `LEFT JOIN u ON t.k = u.k` | `t.merge(u, on="k", how="left")` |
| Union | `UNION ALL` | `pd.concat([a, b])` |
| Window | `SUM(v) OVER (PARTITION BY k ORDER BY d)` | `df.sort_values("d").groupby("k")["v"].cumsum()` |
| Previous row | `LAG(v) OVER (PARTITION BY k ORDER BY d)` | `df.groupby("k")["v"].shift(1)` |
| Rank | `DENSE_RANK() OVER (...)` | `.rank(method="dense")` |
| Pivot | `SUM(v) FILTER (WHERE c = 'x')` | `pivot_table(index=, columns=, values=, aggfunc="sum")` |
| NULL handling | `COALESCE(v, 0)` | `df["v"].fillna(0)` |

## Example

**Business question:** Average price and product count per category for active products, keeping categories with at least five products.

```sql
SELECT c.category_name,
       COUNT(*) AS products,
       ROUND(AVG(p.unit_price), 2) AS avg_price
FROM products p
JOIN categories c ON c.category_id = p.category_id
WHERE NOT p.discontinued
GROUP BY c.category_name
HAVING COUNT(*) >= 5
ORDER BY avg_price DESC;
```

| category_name | products | avg_price |
|---|---|---|
| Beverages | 11 | 41.02 |
| Dairy Products | 10 | 28.73 |
| Confections | 13 | 25.16 |
| Condiments | 11 | 23.22 |
| Grains/Cereals | 6 | 21.29 |
| Seafood | 12 | 20.68 |

The same in pandas:

```python-syntax
df = products.merge(categories, on="category_id")
out = (
    df[~df.discontinued]
      .groupby("category_name")
      .agg(products=("product_id", "size"), avg_price=("unit_price", "mean"))
      .query("products >= 5")
      .round({"avg_price": 2})
      .sort_values("avg_price", ascending=False)
      .reset_index()
)
```

## How it works

1. `JOIN ... ON` maps to `merge(on=...)`; the `how` argument picks inner, left, right or outer.
2. `WHERE` filters rows before grouping; in pandas that is the boolean mask before `groupby`.
3. `GROUP BY` plus aggregates maps to `groupby().agg()` with named aggregations.
4. `HAVING` filters after aggregation, which in pandas is just another filter on the aggregated frame.
5. SQL evaluates clauses in a fixed logical order (see [SQL order of execution](/concepts/sql-order-of-execution)); pandas runs your method chain exactly in the order you write it.

**Window functions** are where the two differ most. SQL keeps every row and adds a computed column:

```sql
WITH monthly AS (
    SELECT DATE_TRUNC('month', o.order_date)::date AS month,
           SUM(od.unit_price * od.quantity * (1 - od.discount)) AS revenue
    FROM orders o
    JOIN order_details od ON od.order_id = o.order_id
    GROUP BY 1
)
SELECT month,
       ROUND(revenue::numeric, 2) AS revenue,
       ROUND(SUM(revenue) OVER (ORDER BY month)::numeric, 2) AS running_total
FROM monthly
ORDER BY month
LIMIT 4;
```

| month | revenue | running_total |
|---|---|---|
| 1996-01-01 | 5217.41 | 5217.41 |
| 1996-04-01 | 18574.06 | 23791.47 |
| 1996-07-01 | 19336.35 | 43127.82 |
| 1996-10-01 | 9197.44 | 52325.26 |

In pandas: `monthly.sort_values("month").assign(running_total=lambda d: d.revenue.cumsum())`. For partitioned windows use `groupby(...).transform(...)`, which also returns one value per original row.

## Common mistakes

- **NULL vs NaN.** SQL aggregates skip `NULL`; pandas skips `NaN` by default too, but `groupby` drops `NaN` keys unless you pass `dropna=False`, while SQL keeps a `NULL` group.
- **`COUNT(*)` vs `count()`.** pandas `count()` skips missing values like `COUNT(col)`; use `size()` for `COUNT(*)`.
- **Join explosions.** Both duplicate rows on many-to-many keys. pandas `merge(validate="one_to_many")` catches it early.
- **Pulling everything into pandas.** Filtering and aggregating in SQL first moves far less data.

## When to use it vs alternatives

| Situation | Better choice |
|---|---|
| Data lives in a database, large tables | SQL |
| Shared, scheduled reporting logic | SQL (views, dbt models) |
| Ad hoc exploration of a file or small extract | pandas |
| Statistics, ML features, plotting | pandas |
| Complex row-by-row or iterative logic | pandas |

A common workflow is SQL to filter and aggregate, then pandas for the last mile.

## Interview questions

### What is the pandas equivalent of SQL GROUP BY?
`df.groupby("key").agg(...)`. Named aggregations such as `agg(total=("revenue", "sum"))` map directly to `SUM(revenue) AS total`.

### How do you do a LEFT JOIN in pandas?
`left.merge(right, on="key", how="left")`. Rows without a match get `NaN` in the right-hand columns, just as SQL fills them with `NULL`.

### How do you write a window function in pandas?
Use `groupby(...).transform(func)` for partitioned aggregates, `cumsum()` for running totals, `shift()` for `LAG`/`LEAD`, and `rank()` for ranking. Sort first, because pandas has no `ORDER BY` inside the window.

### When should you use SQL instead of pandas?
When data is large or already in a database, when the logic must be shared or scheduled, or when you only need an aggregated result. Push filtering and aggregation into SQL and bring back only what you need.

## Practice

Practice this pattern with the questions below.
