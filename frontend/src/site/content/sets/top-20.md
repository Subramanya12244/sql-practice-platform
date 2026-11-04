---
title: Top 20 SQL Interview Questions
slug: top-20
description: The 20 most common SQL interview questions: joins, GROUP BY, HAVING, anti-joins, CTEs, top N per group, running totals and month-over-month growth.
questions: [q01-product-revenue, q03-top-10-customers-by-revenue, q28-customers-with-no-orders, q61-employees-without-a-manager, q25-customers-and-order-count, q15-customers-above-average-orders-correlated-subquery, q06-customers-above-average-revenue, q64-employees-having-the-same-job-title, q79-customer-and-supplier-contact-directory, q110-orders-per-year-and-month, q128-product-price-bands, q131-pivot-category-revenue-by-year, q98-latest-order-per-customer, q99-rank-vs-dense-rank-product-prices, q101-running-total-of-monthly-revenue, q103-month-over-month-revenue-change, q100-top-3-products-by-revenue-per-category, q105-customer-share-of-total-revenue, q14-highest-revenue-product-per-category, q117-year-over-year-revenue-growth]
---

Most SQL interviews, whatever the company or job title, draw from the same small pool of patterns. If you can solve these twenty questions quickly and explain your reasoning, you are ready for the large majority of SQL screens you will see.

The list starts with the fundamentals every interviewer checks in the first five minutes: aggregating revenue with `GROUP BY`, sorting and limiting to a top 10, and finding rows with no match using a `LEFT JOIN ... IS NULL` anti-join. It then moves to filtering groups with `HAVING` and comparing each group with an overall average, which is where many candidates first trip over the difference between `WHERE` and `HAVING`.

The middle of the set covers the patterns that show you can think in sets: self joins, `UNION`, grouping by date parts, `CASE` bucketing and a simple pivot. The final third is window functions, because they are the single most tested advanced topic: latest row per customer, `RANK` versus `DENSE_RANK`, running totals, month-over-month change, top N per group, share of total and year-over-year growth.

Each question runs against the Northwind database, and they are ordered from easy to hard. If you only have an evening before an interview, this is the set to do.

## What you'll practice

- `GROUP BY` aggregates, `ORDER BY` and `LIMIT`
- Anti-joins to find missing matches
- `HAVING` and comparing groups to an overall average
- Self joins and `UNION`
- Date grouping, `CASE` bucketing and pivots
- `ROW_NUMBER`, `RANK` and `DENSE_RANK`, including ties
- Running totals, `LAG` growth and share of total
