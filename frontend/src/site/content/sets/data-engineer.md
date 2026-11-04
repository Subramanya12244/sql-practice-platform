---
title: SQL Interview Questions for Data Engineers
slug: data-engineer
description: SQL interview practice for data engineers: INSERT, UPDATE, upserts, DDL, deduplication, chained CTEs and window functions on a real Northwind database.
questions: [q184-insert-new-shipper-with-returning, q185-raise-prices-for-one-supplier, q85-master-location-directory, q86-entity-record-count-summary, q186-update-prices-using-a-join-with-from, q187-delete-small-order-lines-with-returning, q190-create-customer-revenue-summary-table-as-select, q21-employees-above-average-revenue-using-multiple-ctes, q22-top-employee-by-revenue-using-3-ctes, q55-customers-and-total-orders-full-outer-join, q147-latest-order-per-customer, q150-running-total-of-monthly-revenue, q153-days-until-next-customer-order, q173-normalize-postal-codes-with-replace, q188-upsert-customers-with-on-conflict, q189-create-order-and-lines-with-chained-cte-inserts, q191-add-column-and-check-constraint-to-products, q58-customer-revenue-comparison-advanced, q156-first-and-latest-product-per-customer, q168-first-order-month-cohort-size]
---

Data engineering SQL interviews care less about the final chart and more about whether data lands correctly, once, and stays consistent. Alongside the usual `SELECT` questions you should expect to write `INSERT`, `UPDATE` and `DELETE` statements, explain what happens when a load runs twice, and design a table with the right keys and constraints.

Three themes come up again and again. First, idempotency: an upsert with `INSERT ... ON CONFLICT` or a `MERGE` that can be rerun safely. Second, deduplication: keeping the latest row per key with `ROW_NUMBER()` or `DISTINCT ON`, and reconciling two sources with a `FULL OUTER JOIN` or `UNION`. Third, readable multi-step transformations: chained CTEs that build an intermediate result, then rank, filter or write it somewhere else.

Window functions matter here too, but from a pipeline angle: latest record per entity, running totals for incremental snapshots, the gap between consecutive events, and cohort assignment by first activity date. Interviewers will also probe for data quality instincts, such as normalising strings before matching, adding a `CHECK` constraint instead of trusting the source, and using `RETURNING` to verify exactly which rows a statement touched.

The set below runs on Northwind in PostgreSQL and is ordered from easy to hard. The DML and DDL questions modify data, so run them inside a transaction you can roll back.

## What you'll practice

- `INSERT`, `UPDATE ... FROM` and `DELETE` with `RETURNING`
- Idempotent upserts with `INSERT ... ON CONFLICT DO UPDATE`
- `CREATE TABLE AS`, `ALTER TABLE` and `CHECK` constraints
- Deduplication and latest-row-per-key with window functions
- Reconciling sources with `UNION` and `FULL OUTER JOIN`
- Chained and data-modifying CTEs
- Running totals, `LEAD`/`LAG` event gaps and cohort assignment
