---
title: Data warehouse architecture
slug: dwh-architecture
category: warehousing
difficulty: Beginner
description: The layers of a data warehouse (sources, staging, core, marts) and the Inmon, Kimball and medallion approaches, with PostgreSQL examples.
prerequisites: [dwh-oltp-vs-olap]
related: [dwh-data-marts, dwh-star-schema, dwh-data-modelling, temporary-tables]
questions: []
patterns: []
guides: []
projects: [star-schema-warehouse, end-to-end-pipeline]
minutes: 9
version: 1
---

## Introduction

A warehouse is not one table. It is a set of layers, each with one job: land raw data, clean it, model it, and serve it to users.

## Definition

**Data warehouse architecture** is the arrangement of layers and flows that turns source data into trusted, queryable models. Common layers:

- **Source:** OLTP databases, files, APIs.
- **Staging (raw / bronze):** a copy of source data, with minimal changes.
- **Core / integration (silver):** cleaned, conformed, deduplicated data, often with history.
- **Presentation / marts (gold):** star schemas and aggregates for BI.

## Why it matters

Layers make pipelines easier to debug and rerun. If a mart is wrong, you can rebuild it from core without re-extracting from the source. Interviewers often ask you to sketch this flow.

## How it works

- **Kimball (bottom-up):** build conformed star schemas per business process; together they form the warehouse.
- **Inmon (top-down):** build a normalised enterprise warehouse first, then derive marts.
- **Medallion (lakehouse):** bronze, silver, gold layers, the same idea with different names.

ETL transforms before loading; ELT loads raw data first and transforms inside the warehouse with SQL (dbt is the usual tool).

## Syntax and configuration

In PostgreSQL, layers are often schemas:

```sql-syntax
CREATE SCHEMA staging;
CREATE SCHEMA core;
CREATE SCHEMA mart;

CREATE TABLE staging.orders AS SELECT * FROM source_orders;      -- land
CREATE TABLE core.orders    AS SELECT ... FROM staging.orders;   -- clean
CREATE TABLE mart.fact_sales AS SELECT ... FROM core.orders ...; -- model
```

## Examples

Staging: copy the source as-is, plus load metadata.

```sql
CREATE TEMP TABLE stg_orders AS
SELECT o.*, now() AS _loaded_at, 'northwind' AS _source
FROM orders o;

SELECT COUNT(*) AS rows_loaded, MIN(order_date), MAX(order_date)
FROM stg_orders;
```

## Architecture

```mermaid
flowchart LR
  src["Sources: OLTP, files, APIs"] --> stg["Staging (raw)"]
  stg --> core["Core (clean, conformed, history)"]
  core --> mart["Marts (star schemas)"]
  mart --> bi["BI and reports"]
```

Each arrow is a pipeline step that can be rerun on its own.

## Practical example

Three layers in one transaction: staging, a cleaned core table, and a mart aggregate.

```sql
CREATE TEMP TABLE stg_orders AS
SELECT * FROM orders;

CREATE TEMP TABLE core_orders AS
SELECT order_id,
       customer_id,
       COALESCE(employee_id, -1) AS employee_id,   -- unknown member
       order_date,
       shipped_date,
       freight
FROM stg_orders
WHERE order_date IS NOT NULL;

CREATE TEMP TABLE mart_monthly_freight AS
SELECT date_trunc('month', order_date)::date AS month,
       COUNT(*) AS orders,
       SUM(freight) AS freight
FROM core_orders
GROUP BY 1;

SELECT * FROM mart_monthly_freight ORDER BY month LIMIT 5;
```

## Exercises

1. A mart shows wrong totals. Which layer do you rebuild first?
   <details><summary>Answer</summary>Check core for the bug; if core is right, rebuild only the mart from core. Re-extracting from source is the last resort.</details>
2. What is the difference between ETL and ELT?
   <details><summary>Answer</summary>ETL transforms before loading into the warehouse; ELT loads raw data first and transforms inside the warehouse.</details>
3. Map bronze, silver and gold to the classic layers.
   <details><summary>Answer</summary>Bronze is staging, silver is core, gold is marts.</details>

## Common mistakes

- Letting BI tools query staging tables directly.
- Transforming in staging, so you cannot replay raw data.
- No load metadata (`_loaded_at`, source, batch id), which makes debugging hard.

## Performance and best practices

- Keep staging append-only and cheap to load.
- Make each layer idempotent: rerunning a load gives the same result.
- Build marts as tables or materialized views, not deep chains of views.

## Interview questions

### Kimball or Inmon?

Kimball builds dimensional marts per process with conformed dimensions, fast to deliver. Inmon builds a normalised enterprise model first, more upfront work but one integrated core. Most modern teams use Kimball-style marts on a layered (medallion) platform.

### Why have a staging layer?

It decouples extraction from transformation, keeps a replayable raw copy, and limits load on the source.

### What is ELT and why is it popular?

Load raw data first, then transform in SQL inside the warehouse. Cloud warehouses have cheap compute, and tools like dbt make SQL transforms testable.

## Quick revision

- Layers: source, staging, core, marts.
- Medallion: bronze, silver, gold.
- Kimball bottom-up, Inmon top-down.
- ELT transforms inside the warehouse.
- Every layer should be rerunnable.
