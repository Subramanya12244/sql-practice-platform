---
title: SQL Interview Questions for Data Analysts
slug: data-analyst
description: Practice the SQL interview questions data analysts get: revenue aggregates, joins, LEFT JOIN gaps, date grouping and CASE segmentation on Northwind.
questions: [q01-product-revenue, q02-category-revenue, q03-top-10-customers-by-revenue, q28-customers-with-no-orders, q110-orders-per-year-and-month, q111-revenue-by-quarter, q128-product-price-bands, q11-revenue-by-shipper, q25-customers-and-order-count, q31-customers-and-total-revenue, q06-customers-above-average-revenue, q09-top-categories-by-number-of-orders, q113-average-days-to-ship-per-shipper, q116-orders-by-day-of-week, q130-employee-shipping-status-counts, q131-pivot-category-revenue-by-year, q133-average-order-value-with-nullif-and-coalesce, q103-month-over-month-revenue-change, q105-customer-share-of-total-revenue, q117-year-over-year-revenue-growth, q134-customer-value-segment-summary]
---

Data analyst SQL interviews are about turning a business question into a correct number. You will rarely be asked to design a schema or tune an index. Instead, an interviewer hands you a few tables (orders, customers, products) and asks things like "what was revenue by category last quarter?" or "which customers have never ordered?" They are watching whether you pick the right grain, join without duplicating rows, and handle missing data honestly.

The core toolkit is small but must be automatic: `SUM`, `COUNT` and `AVG` with `GROUP BY`, `HAVING` for filtering groups, inner and left joins across three or four tables, and `CASE` for bucketing. Date work comes up constantly: grouping by month or quarter, computing days between two dates, and comparing one period with the previous one. Expect at least one question where a `LEFT JOIN` is required to keep zero-activity rows, and one where `NULL` silently breaks an average or a division.

Stronger candidates also reach for a light window function when the question asks for share of total, month-over-month change or year-over-year growth. These are the questions that separate a junior analyst from a senior one, so the set ends with them.

The questions below run on the Northwind database and are ordered from easy to hard. Work through them in order; each one adds a single new idea on top of the last.

## What you'll practice

- Revenue aggregates at product, category, customer and shipper grain
- Multi-table joins without double counting
- `LEFT JOIN` and anti-joins to find customers or products with no activity
- Grouping by year, quarter, month and day of week
- `CASE` bucketing, conditional aggregation and simple pivots
- Safe division with `NULLIF` and `COALESCE`
- Share of total, month-over-month and year-over-year growth
