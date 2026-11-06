---
title: PySpark data transformation
slug: pyspark-transformation
level: Advanced
description: Prototype PySpark logic in pandas: aggregates, windows, hash partitioning and salting for skew, then validate the Spark SQL on PostgreSQL.
technologies: [PySpark, Spark SQL, pandas, PostgreSQL]
dataset: ecommerce
prerequisites: [spark-dataframes, spark-transformations, spark-aggregations, spark-partitioning, spark-shuffling, spark-sql]
minutes: 180
---
## Business problem

The e-commerce event volume has outgrown a single machine, and the team is moving its daily customer-value job to Spark. Before paying for a cluster, they want the transformation logic proven on samples, and they want to understand why one country's partition takes ten times longer than the rest.

## Learning objectives

- Map `groupBy().agg()` and window functions to pandas equivalents
- Understand hash partitioning and why skewed keys slow a shuffle
- Use salting to spread a hot key across partitions
- Write the job's Spark SQL and validate it on PostgreSQL
- Package and submit a PySpark job

## Architecture

The job reads orders, filters recognised revenue, aggregates per user and ranks users per country.

```mermaid
flowchart LR
  read["Read orders"] --> filter["Filter recognised statuses"]
  filter --> agg["groupBy user"]
  agg --> rank["Window rank per country"]
  rank --> write["Write user_ltv"]
```

## Technologies

- **PySpark** DataFrame API and **Spark SQL**
- **pandas** to prototype the same logic locally
- **PostgreSQL**: the Spark SQL here is ANSI enough to run unchanged

## Dataset

Python tasks use small inline CSVs. The SQL task uses the **ecommerce** dataset: 700 orders from 196 users. Recognised statuses are `paid`, `shipped` and `delivered`.

## Tasks

Each pandas task notes the PySpark code it mirrors. Each task runs in its own rolled-back transaction, so create every table the check needs in this task.

```task
{
 "id": "groupby-agg",
 "title": "groupBy().agg() in pandas",
 "type": "python",
 "instructions": "PySpark:\n\n```python-syntax\ndf.filter(F.col('status').isin('paid', 'shipped', 'delivered'))\n  .groupBy('country', F.date_format('order_date', 'yyyy-MM').alias('month'))\n  .agg(F.sum('amount').alias('revenue'), F.countDistinct('user_id').alias('buyers'))\n```\n\nWrite `revenue_by_country_month(df)` returning the same result as a DataFrame with columns `country`, `month` (string `YYYY-MM`), `revenue`, `buyers`, sorted by `country`, `month` with a fresh index.",
 "starter": "import io\nimport pandas as pd\nCSV = \"\"\"order_id,user_id,country,order_date,status,amount\n1,10,USA,2025-01-05,delivered,100.0\n2,11,USA,2025-01-20,cancelled,50.0\n3,12,UK,2025-01-21,shipped,80.0\n4,10,USA,2025-02-02,delivered,40.0\n5,13,UK,2025-02-14,paid,60.0\n6,12,UK,2025-02-20,refunded,30.0\n\"\"\"\ndf = pd.read_csv(io.StringIO(CSV), parse_dates=['order_date'])\n\ndef revenue_by_country_month(df):\n    return df.groupby('country', as_index=False)['amount'].sum()\n",
 "solution": "import io\nimport pandas as pd\nCSV = \"\"\"order_id,user_id,country,order_date,status,amount\n1,10,USA,2025-01-05,delivered,100.0\n2,11,USA,2025-01-20,cancelled,50.0\n3,12,UK,2025-01-21,shipped,80.0\n4,10,USA,2025-02-02,delivered,40.0\n5,13,UK,2025-02-14,paid,60.0\n6,12,UK,2025-02-20,refunded,30.0\n\"\"\"\ndf = pd.read_csv(io.StringIO(CSV), parse_dates=['order_date'])\n\ndef revenue_by_country_month(df):\n    ok = df[df['status'].isin(['paid', 'shipped', 'delivered'])]\n    out = (ok.assign(month=ok['order_date'].dt.strftime('%Y-%m'))\n             .groupby(['country', 'month'])\n             .agg(revenue=('amount', 'sum'), buyers=('user_id', 'nunique'))\n             .reset_index()\n             .sort_values(['country', 'month'])\n             .reset_index(drop=True))\n    return out\n",
 "tests": "r = revenue_by_country_month(df)\nassert list(r.columns) == ['country', 'month', 'revenue', 'buyers']\nassert r.values.tolist() == [['UK', '2025-01', 80.0, 1], ['UK', '2025-02', 60.0, 1], ['USA', '2025-01', 100.0, 1], ['USA', '2025-02', 40.0, 1]]"
}
```

```task
{
 "id": "window-functions",
 "title": "Window functions in pandas",
 "type": "python",
 "instructions": "PySpark:\n\n```python-syntax\nw = Window.partitionBy('category').orderBy(F.desc('revenue'))\ndf.withColumn('rnk', F.dense_rank().over(w))\n  .withColumn('running', F.sum('revenue').over(w.rowsBetween(Window.unboundedPreceding, 0)))\n```\n\nWrite `rank_within_category(df)` adding integer `rnk` (dense rank by revenue descending within category) and `running` (running sum in that order; ties ordered by `product`). Return rows sorted by `category`, `rnk`, `product` with a fresh index.",
 "starter": "import pandas as pd\n\ndf = pd.DataFrame({'category': ['A', 'A', 'A', 'B', 'B'], 'product': ['p1', 'p2', 'p3', 'p4', 'p5'], 'revenue': [50, 80, 50, 10, 30]})\n\ndef rank_within_category(df):\n    return df.assign(rnk=1, running=df['revenue'])\n",
 "solution": "import pandas as pd\n\ndf = pd.DataFrame({'category': ['A', 'A', 'A', 'B', 'B'], 'product': ['p1', 'p2', 'p3', 'p4', 'p5'], 'revenue': [50, 80, 50, 10, 30]})\n\ndef rank_within_category(df):\n    out = df.sort_values(['category', 'revenue', 'product'], ascending=[True, False, True]).copy()\n    out['rnk'] = out.groupby('category')['revenue'].rank(method='dense', ascending=False).astype(int)\n    out['running'] = out.groupby('category')['revenue'].cumsum()\n    return out.sort_values(['category', 'rnk', 'product']).reset_index(drop=True)\n",
 "tests": "r = rank_within_category(df)\nassert r['product'].tolist() == ['p2', 'p1', 'p3', 'p5', 'p4']\nassert r['rnk'].tolist() == [1, 2, 2, 1, 2]\nassert r['running'].tolist() == [80, 130, 180, 30, 40]"
}
```

```task
{
 "id": "partition-skew",
 "title": "Hash partitioning and salting",
 "type": "python",
 "instructions": "Spark puts a row in partition `hash(key) % n`. Use a stable hash: `zlib.crc32(str(key).encode())`.\n\n- `partition_of(key, n)` returns the partition number.\n- `partition_sizes(keys, n)` returns a list of `n` row counts.\n- `salt(keys, buckets)` returns new keys `f\"{key}_{i % buckets}\"` where `i` is the row's position; this spreads a hot key.\n- `skew_ratio(sizes)` = max size / mean size, rounded to 2 decimals.",
 "starter": "import zlib\n\ndef partition_of(key, n):\n    return hash(key) % n\n\ndef partition_sizes(keys, n):\n    return [0] * n\n\ndef salt(keys, buckets):\n    return list(keys)\n\ndef skew_ratio(sizes):\n    return 1.0\n",
 "solution": "import zlib\n\ndef partition_of(key, n):\n    return zlib.crc32(str(key).encode()) % n\n\ndef partition_sizes(keys, n):\n    sizes = [0] * n\n    for k in keys:\n        sizes[partition_of(k, n)] += 1\n    return sizes\n\ndef salt(keys, buckets):\n    return [f'{k}_{i % buckets}' for i, k in enumerate(keys)]\n\ndef skew_ratio(sizes):\n    return round(max(sizes) / (sum(sizes) / len(sizes)), 2)\n",
 "tests": "assert partition_of('USA', 8) == zlib.crc32(b'USA') % 8\nkeys = ['USA'] * 900 + ['UK', 'India', 'Germany', 'Canada'] * 25\nsizes = partition_sizes(keys, 4)\nassert sum(sizes) == 1000 and max(sizes) >= 900\nassert skew_ratio(sizes) >= 3.6\nsalted = salt(keys, 4)\nassert salted[:5] == ['USA_0', 'USA_1', 'USA_2', 'USA_3', 'USA_0']\nhot = [k for k in salted if k.startswith('USA_')]\nassert len(set(hot)) == 4\nassert skew_ratio(partition_sizes(salted, 4)) < skew_ratio(sizes)"
}
```

```task
{
 "id": "spark-sql-ltv",
 "title": "Validate the job's Spark SQL",
 "type": "sql",
 "instructions": "This Spark SQL runs unchanged on PostgreSQL. Create `user_ltv(user_id, country, orders, revenue, first_order, last_order, country_rank)`:\n\n- Only orders with status `paid`, `shipped` or `delivered`.\n- `revenue` = sum of `quantity * unit_price` of their items.\n- `country` is the user's country (`'Unknown'` when NULL).\n- `country_rank` = `DENSE_RANK()` by revenue descending within country.",
 "starter": "CREATE TABLE user_ltv AS\nSELECT o.user_id, COUNT(*) AS orders\nFROM orders o GROUP BY o.user_id;  -- TODO",
 "solution": "CREATE TABLE user_ltv AS\nWITH rev AS (\n  SELECT o.user_id, COUNT(DISTINCT o.order_id) AS orders,\n         SUM(oi.quantity * oi.unit_price) AS revenue,\n         MIN(o.order_date) AS first_order, MAX(o.order_date) AS last_order\n  FROM orders o\n  JOIN order_items oi ON oi.order_id = o.order_id\n  WHERE o.status IN ('paid', 'shipped', 'delivered')\n  GROUP BY o.user_id\n)\nSELECT r.user_id, COALESCE(u.country, 'Unknown') AS country, r.orders, r.revenue, r.first_order, r.last_order,\n       DENSE_RANK() OVER (PARTITION BY COALESCE(u.country, 'Unknown') ORDER BY r.revenue DESC) AS country_rank\nFROM rev r JOIN users u ON u.user_id = r.user_id;",
 "check": "SELECT (COALESCE(((SELECT COUNT(*) FROM information_schema.columns WHERE table_schema = current_schema() AND table_name = 'user_ltv' AND column_name IN ('user_id','country','orders','revenue','first_order','last_order','country_rank')) = 7), FALSE) AND COALESCE(((SELECT COUNT(*) FROM user_ltv) = (SELECT COUNT(DISTINCT o.user_id) FROM orders o JOIN order_items i USING (order_id) WHERE o.status IN ('paid','shipped','delivered'))), FALSE) AND COALESCE(((SELECT SUM(revenue) FROM user_ltv) = (SELECT SUM(i.quantity * i.unit_price) FROM orders o JOIN order_items i USING (order_id) WHERE o.status IN ('paid','shipped','delivered'))), FALSE) AND COALESCE((NOT EXISTS (SELECT 1 FROM user_ltv WHERE country IS NULL) AND (SELECT COUNT(*) FROM user_ltv WHERE country_rank = 1) >= (SELECT COUNT(DISTINCT country) FROM user_ltv)), FALSE)) AS ok, CASE WHEN NOT COALESCE(((SELECT COUNT(*) FROM information_schema.columns WHERE table_schema = current_schema() AND table_name = 'user_ltv' AND column_name IN ('user_id','country','orders','revenue','first_order','last_order','country_rank')) = 7), FALSE) THEN 'user_ltv is missing a column' WHEN NOT COALESCE(((SELECT COUNT(*) FROM user_ltv) = (SELECT COUNT(DISTINCT o.user_id) FROM orders o JOIN order_items i USING (order_id) WHERE o.status IN ('paid','shipped','delivered'))), FALSE) THEN 'one row per user with recognised orders' WHEN NOT COALESCE(((SELECT SUM(revenue) FROM user_ltv) = (SELECT SUM(i.quantity * i.unit_price) FROM orders o JOIN order_items i USING (order_id) WHERE o.status IN ('paid','shipped','delivered'))), FALSE) THEN 'revenue totals do not match' WHEN NOT COALESCE((NOT EXISTS (SELECT 1 FROM user_ltv WHERE country IS NULL) AND (SELECT COUNT(*) FROM user_ltv WHERE country_rank = 1) >= (SELECT COUNT(DISTINCT country) FROM user_ltv)), FALSE) THEN 'every country needs a rank 1 and no NULL countries' ELSE 'user_ltv is correct' END AS message"
}
```

```task
{
 "id": "spark-submit",
 "title": "Run it on Spark",
 "type": "checklist",
 "instructions": "Port the prototype to PySpark.",
 "items": [
  "`pip install pyspark` (Java 11 or 17 required) or use a Databricks/EMR notebook",
  "Export the ecommerce tables to Parquet and read them with `spark.read.parquet`",
  "Rewrite the pandas tasks with the DataFrame API and compare results on the sample data",
  "Enable `spark.sql.adaptive.enabled` and `spark.sql.adaptive.skewJoin.enabled`",
  "Run with `spark-submit --master local[4] user_ltv.py` and inspect stages in the Spark UI (port 4040)",
  "Write `user_ltv` partitioned by `country` and check the file layout"
 ]
}
```

## Design decisions

Real pipelines are mostly decisions. Pick the option that fits each scenario; every option explains itself once you answer.

```task
{
  "id": "d-skew",
  "title": "A skewed join",
  "type": "decision",
  "instructions": "Joining 2 billion events to 5 million users: one 'anonymous' user owns 30% of events and one task runs for hours.",
  "options": [
    "Add more executors",
    "Salt the hot key (or filter/handle it separately) and broadcast the small side where possible",
    "Collect both sides to the driver",
    "Repartition by a random column after the join"
  ],
  "answer": 1,
  "why": [
    "The single hot partition is still processed by one task.",
    "Spreading the hot key across partitions, or handling it separately, removes the straggler; broadcasting avoids the shuffle.",
    "Will not fit in driver memory.",
    "Too late: the skew happens during the join shuffle."
  ]
}
```

```task
{
  "id": "d-file-format",
  "title": "Output format for the lake",
  "type": "decision",
  "instructions": "Analysts query a few columns of very wide tables, filtered by date.",
  "options": [
    "CSV",
    "JSON lines",
    "Parquet partitioned by date",
    "One big text file"
  ],
  "answer": 2,
  "why": [
    "Row-oriented, no types and no column pruning.",
    "Readable but large and slow to scan.",
    "Columnar storage reads only the needed columns, and date partitions let queries skip whole folders.",
    "Unsplittable and unqueryable at scale."
  ]
}
```

## Expected output

- `revenue_by_country_month` returns 4 rows (USA and UK × Jan/Feb 2025)
- `rank_within_category` gives dense ranks and running totals per category
- Salting spreads the hot key over all partitions
- `user_ltv` has 184 rows

## Common mistakes

- Calling `collect()` on a large DataFrame, which pulls all data to the driver.
- Using a Python UDF where a built-in function exists; UDFs block Catalyst optimisation.
- Joining on a skewed key without salting or AQE skew-join handling.
- Forgetting that transformations are lazy, then timing the wrong step.

## Interview discussion questions

### What triggers a shuffle?
Wide transformations: `groupBy`, `join` (unless broadcast), `distinct`, `repartition` and window functions with `partitionBy`. Data with the same key must move to the same partition.

### How do you handle data skew?
Enable AQE skew-join handling, broadcast the small side, or salt the hot key: add a random suffix, aggregate partially, then aggregate again without the salt.

### DataFrame API or Spark SQL?
Both compile to the same logical plan through Catalyst. Pick whichever is clearer for the team; SQL is easy to review, the API composes better in code.

## Summary

You proved the job's logic on pandas, learned why skew hurts and how salting fixes it, and validated the Spark SQL before running it on a cluster.
