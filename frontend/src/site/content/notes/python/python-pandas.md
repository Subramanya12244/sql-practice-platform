---
title: Pandas
slug: python-pandas
category: python
difficulty: Intermediate
description: Pandas for data engineers - DataFrames, read_csv dtypes, filtering, groupby, merge, null handling, dedup and the SQL equivalents of each operation.
prerequisites: [python-collections, python-csv-json]
related: [python-numpy, python-database-connectivity, python-etl-pipelines, left-join, group-by]
questions: []
patterns: []
guides: []
projects: [python-data-cleaning, csv-to-postgres-etl, sales-analytics-pipeline]
minutes: 14
version: 1
---

## Introduction

Most Python data work starts with a CSV or a query result and ends with a cleaned table. pandas gives you a SQL-like table in memory: filter, join, group and reshape with a few lines.

## Definition

pandas is a library built on NumPy. Its core types are `Series` (one labelled column) and `DataFrame` (a table of named columns sharing an index).

## Why it matters

- The default tool for small and medium transformations (up to a few GB).
- Reads and writes CSV, JSON, Parquet, Excel and SQL.
- Interviews often ask for the pandas version of a SQL query.

## How it works

- Each column is a typed array (`int64`, `float64`, `object`, `datetime64`, `category`...).
- Operations are vectorised over whole columns, not Python loops.
- Most methods return a new DataFrame; assign the result back.
- Missing values are `NaN` / `NaT` / `pd.NA`.

| SQL | pandas |
|---|---|
| `WHERE` | `df[df.col > 5]` or `df.query("col > 5")` |
| `GROUP BY` | `df.groupby("k").agg(...)` |
| `JOIN` | `df.merge(other, on="k", how="left")` |
| `ORDER BY` | `df.sort_values("col")` |
| `DISTINCT` | `df.drop_duplicates()` |
| `COALESCE` | `df.col.fillna(0)` |

## Syntax and configuration

```python-syntax
import pandas as pd

df = pd.read_csv(path, dtype={"customer_id": "string"}, parse_dates=["order_date"])
df = df[df["amount"] > 0]
df = df.assign(year=df["order_date"].dt.year)
summary = df.groupby("customer_id", as_index=False).agg(total=("amount", "sum"),
                                                       orders=("order_id", "count"))
joined = orders.merge(customers, on="customer_id", how="left", validate="many_to_one")
df.to_parquet("out.parquet", index=False)
```

## Examples

Read CSV, filter, add a column, aggregate:

```python
import io
import pandas as pd

csv = io.StringIO("""order_id,customer_id,order_date,amount
1,ALFKI,2024-01-05,120.5
2,ANATR,2024-01-06,80
3,ALFKI,2024-02-10,45
4,BONAP,2024-02-11,
""")
df = pd.read_csv(csv, parse_dates=["order_date"])
print(df.dtypes.to_dict())

df["amount"] = df["amount"].fillna(0)
df["month"] = df["order_date"].dt.to_period("M").astype(str)
by_month = df.groupby("month", as_index=False).agg(revenue=("amount", "sum"), orders=("order_id", "count"))
print(by_month)
```

Left join and anti-join:

```python
import pandas as pd

customers = pd.DataFrame({"customer_id": ["ALFKI", "ANATR", "FISSA"],
                          "country": ["Germany", "Mexico", "Spain"]})
orders = pd.DataFrame({"order_id": [1, 2, 3], "customer_id": ["ALFKI", "ALFKI", "ANATR"]})

joined = customers.merge(orders, on="customer_id", how="left", indicator=True)
print(joined)
no_orders = joined.loc[joined["_merge"] == "left_only", "customer_id"].tolist()
print("no orders:", no_orders)
```

## Architecture

A typical pandas transform step inside a pipeline:

```mermaid
flowchart LR
    src["CSV or SQL query"] --> read["read_csv with dtypes"]
    read --> clean["clean nulls and types"]
    clean --> join["merge lookups"]
    join --> agg["groupby aggregate"]
    agg --> out["to_sql or to_parquet"]
```

## Practical example

Clean messy input: trim strings, normalise case, coerce bad numbers, dedupe on the latest record:

```python
import io
import pandas as pd

raw = io.StringIO("""id,email,signup,score
1, Alice@X.com ,2024-01-01,10
2,bob@x.com,2024-01-02,abc
1,alice@x.com,2024-03-01,12
3,,2024-01-05,7
""")
df = pd.read_csv(raw)
df["email"] = df["email"].str.strip().str.lower()
df["score"] = pd.to_numeric(df["score"], errors="coerce")
df["signup"] = pd.to_datetime(df["signup"])

df = df.dropna(subset=["email"])
latest = df.sort_values("signup").drop_duplicates("id", keep="last")
print(latest.sort_values("id").to_dict("records"))
print("bad scores:", int(df["score"].isna().sum()))
```

## Exercises

1. Write the pandas version of `SELECT customer_id, SUM(amount) FROM orders GROUP BY customer_id`.
<details><summary>Answer</summary>

`orders.groupby("customer_id", as_index=False)["amount"].sum()`.
</details>

2. How do you find rows in `a` with no match in `b`?
<details><summary>Answer</summary>

`a.merge(b, on="k", how="left", indicator=True)` and keep `_merge == "left_only"`, or `a[~a.k.isin(b.k)]`.
</details>

3. Why pass `dtype={"zip": "string"}` to `read_csv`?
<details><summary>Answer</summary>

Otherwise ZIP codes like `02134` are read as integers and lose leading zeros.
</details>

## Common mistakes

- `SettingWithCopyWarning`: chain assignment on a slice. Use `.loc[mask, "col"] = v` or `.copy()`.
- Iterating rows with `iterrows` instead of vectorised operations.
- Merges that silently duplicate rows. Use `validate="many_to_one"`.
- Comparing to `NaN` with `==`; use `isna()`.
- Forgetting that `groupby` drops NaN keys unless `dropna=False`.

## Performance and best practices

- Declare `dtype` and `usecols` on read; use `category` for low-cardinality strings.
- Use `chunksize` for files larger than memory.
- Prefer Parquet over CSV for intermediate data.
- Push heavy filtering and joins into the database when the data lives there.
- Past a few GB, consider Polars, DuckDB or Spark.

## Interview questions

### What is the difference between a Series and a DataFrame?

A Series is one labelled 1-D array. A DataFrame is a 2-D table of Series sharing one index.

### How do merge and join differ?

`merge` joins on columns (like SQL). `join` joins on the index by default. Both support `how="inner|left|right|outer"`.

### How do you process a CSV that does not fit in memory?

`pd.read_csv(path, chunksize=100_000)` and aggregate or load each chunk, or use a database or Spark.

### What does apply cost compared to vectorised operations?

`apply` calls a Python function per row or element, so it is often 10-100x slower than column-wise arithmetic or `.str` / `.dt` methods.

## Quick revision

- DataFrame = table of typed columns; Series = one column.
- `read_csv(dtype=..., parse_dates=...)` to control types.
- `merge(how="left", indicator=True)` for joins and anti-joins.
- `groupby(...).agg(name=("col", "func"))` for named aggregates.
- `fillna`, `dropna`, `isna` for nulls; `drop_duplicates` for dedup.
- Vectorise; avoid `iterrows`.
