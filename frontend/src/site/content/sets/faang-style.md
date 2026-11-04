---
title: FAANG-Style SQL Interview Questions
slug: faang-style
description: Hard FAANG-style SQL interview questions: window functions, top N per group, self joins, gaps between events, ranking ties and cohorts on Northwind.
questions: [q64-employees-having-the-same-job-title, q98-latest-order-per-customer, q99-rank-vs-dense-rank-product-prices, q63-employees-reporting-to-the-same-manager, q100-top-3-products-by-revenue-per-category, q102-three-month-moving-average-revenue, q103-month-over-month-revenue-change, q104-days-until-next-customer-order, q106-customer-revenue-quartiles, q13-products-sold-above-category-average-quantity, q14-highest-revenue-product-per-category, q18-customer-revenue-above-employee-average, q23-best-customer-per-employee, q50-top-customer-s-by-revenue-tie-safe-interview-level, q107-first-and-latest-product-per-customer, q108-employee-revenue-percentile-rank, q109-average-gap-between-employee-orders, q117-year-over-year-revenue-growth, q118-customers-inactive-in-last-six-months, q119-first-order-month-cohort-size, q92-countries-with-more-customers-than-employees-and-suppliers, q93-countries-with-balanced-business-entities]
---

SQL rounds at large tech companies are short, timed and deliberately ambiguous. You typically get one or two questions in 30 to 45 minutes, a schema described in a few lines, and an interviewer who expects you to ask clarifying questions before you type. The basics are assumed. What is actually being tested is whether you can decompose a multi-step problem, pick the right window function, and handle ties and edge cases without being prompted.

The recurring patterns are well known. Top N per group with `ROW_NUMBER`, `RANK` or `DENSE_RANK`, and a clear answer on how ties are treated. Comparisons with the previous row using `LAG` and `LEAD`: month-over-month growth, days between events, churn and inactivity. Moving averages and running totals with explicit window frames. Self joins for pairs (employees who share a manager, customers in the same city) with the `a.id < b.id` trick to avoid duplicates. Cohorts based on first activity, percentiles and quartiles, and "compare each row with its peer group average" questions solved with a correlated subquery or a partitioned window.

Interviewers also listen to how you talk. Say the grain of every CTE out loud, state your tie-breaking rule, and mention what happens with `NULL` or an empty group. A correct query with a clear explanation beats a clever one-liner.

The questions below are ordered from easy to hard and finish with multi-CTE problems that resemble a real onsite round.

## What you'll practice

- Top N and first or latest row per group, with explicit tie handling
- `LAG`, `LEAD`, moving averages and window frames
- Self joins for pairs without duplicate rows
- Peer-group comparisons with correlated subqueries and partitioned windows
- Percentiles, quartiles and percent rank
- Inactivity, retention-style and cohort questions
- Chaining several CTEs into one readable answer
