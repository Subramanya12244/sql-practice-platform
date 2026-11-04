---
slug: sql-interview-questions-for-data-analysts
title: SQL Interview Questions for Data Analysts (with Practice)
description: SQL interview questions for data analysts by skill: aggregation, joins, CTEs, window functions, dates, NULLs and set operators, with free Northwind practice.
keywords: sql interview questions for data analysts, data analyst sql interview questions, sql interview questions and answers, sql practice questions, sql interview preparation, advanced sql interview questions
questions: 3, 6, 25, 28, 19, 100, 101, 117, 79, 50
related: group-by-having, left-join, cte, window-functions, top-n-per-group, date-functions-postgresql, null-handling-coalesce, union-vs-union-all, sql-order-of-execution, exists-vs-in
---

SQL interviews for data analyst roles test whether you can turn a business question into a correct query on a real schema, quickly and without silent mistakes. Most questions come from a small set of patterns: aggregate and filter, join without losing or duplicating rows, rank within groups, compare periods, and handle NULLs. This guide lists those patterns with practice questions on the Northwind database (PostgreSQL), each linked to an interactive page where you can write and check your answer.

## What interviewers test

A typical analyst SQL round is 2–4 questions in 30–60 minutes, usually on a schema of customers, orders, products and employees much like Northwind. Interviewers look for:

- **Correct grain.** Do you know whether the answer is one row per customer, per order, or per order line, and do you aggregate at the right level before joining or ranking?
- **Join judgment.** Can you choose `INNER` vs `LEFT`, spot fan-out that inflates sums, and find unmatched rows?
- **Filtering at the right stage.** `WHERE` vs `HAVING` vs an outer query around a window function. See [SQL order of execution](/concepts/sql-order-of-execution).
- **Edge cases.** Ties, NULLs, customers with zero orders, empty periods, division by zero.
- **Readability.** CTEs with clear names, consistent aliases, explicit column lists.
- **Talking through it.** Stating assumptions ("revenue is `unit_price * quantity * (1 - discount)`") before writing.

The skill groups below follow roughly the order in which interviews escalate.

## Skill group 1: Aggregation and GROUP BY

The foundation: totals, counts and averages per group, and filtering groups with `HAVING`. Guides: [GROUP BY and HAVING](/concepts/group-by-having), [aggregate functions](/concepts/aggregate-functions).

- [Top 10 Customers by Revenue](/questions/q03-top-10-customers-by-revenue): revenue formula, `SUM` across a join, `ORDER BY ... LIMIT`.
- [Category Revenue](/questions/q02-category-revenue): aggregating through a three-table join path.
- [Customers Above Average Revenue](/questions/q06-customers-above-average-revenue): comparing each group's total with an average of totals in `HAVING`.
- [Revenue by Shipper](/questions/q11-revenue-by-shipper): grouping by a dimension that is not the obvious key.

A frequent follow-up is "what if two customers tie for 10th place?", which leads to ranking functions.

## Skill group 2: Joins

Expect at least one question where an `INNER JOIN` gives the wrong answer. Guides: [INNER JOIN](/concepts/inner-join), [LEFT JOIN](/concepts/left-join), [FULL OUTER JOIN](/concepts/full-outer-join), [SELF JOIN](/concepts/self-join).

- [Customers and Order Count](/questions/q25-customers-and-order-count): `LEFT JOIN` plus `COUNT(column)` so zero-order customers show 0.
- [Customers with No Orders](/questions/q28-customers-with-no-orders): the anti join, written as `LEFT JOIN ... IS NULL` or `NOT EXISTS`.
- [Customers and Total Revenue](/questions/q31-customers-and-total-revenue): keeping every link of a chained join `LEFT` and using `COALESCE`.
- [Employees Reporting to the Same Manager](/questions/q63-employees-reporting-to-the-same-manager): self-join on a hierarchy column with pair de-duplication.

## Skill group 3: Subqueries and CTEs

Multi-step questions such as "above average" or "best X per Y" need either a subquery or a CTE. Guides: [CTE](/concepts/cte), [correlated subquery](/concepts/correlated-subquery), [EXISTS vs IN](/concepts/exists-vs-in).

- [Customers Above Average Orders (Correlated Subquery)](/questions/q15-customers-above-average-orders-correlated-subquery): a subquery evaluated per outer row.
- [Customers Above Average Revenue Using CTE](/questions/q19-customers-above-average-revenue-using-cte): aggregate in one step, compare in the next.
- [Top Employee by Revenue Using 3 CTEs](/questions/q22-top-employee-by-revenue-using-3-ctes): chaining readable steps.
- [Customer Revenue Above Employee Average](/questions/q18-customer-revenue-above-employee-average): correlating at two levels of grouping.

## Skill group 4: Window functions

The skill that most separates mid-level from junior candidates. Guides: [window functions](/concepts/window-functions), [RANK vs DENSE_RANK vs ROW_NUMBER](/concepts/rank-vs-dense-rank-vs-row-number), [top N per group](/concepts/top-n-per-group), [running total](/concepts/running-total), [LAG and LEAD](/concepts/lag-and-lead).

- [Top 3 Products by Revenue per Category](/questions/q149-top-3-products-by-revenue-per-category): `ROW_NUMBER` or `DENSE_RANK` partitioned by category, filtered outside.
- [RANK vs DENSE_RANK Product Prices](/questions/q148-rank-vs-dense-rank-product-prices): explaining tie behaviour.
- [Running Total of Monthly Revenue](/questions/q150-running-total-of-monthly-revenue): `SUM() OVER (ORDER BY month)` on a pre-aggregated CTE.
- [Days Until Next Customer Order](/questions/q153-days-until-next-customer-order): `LEAD` within a customer partition.
- [Customer Share of Total Revenue](/questions/q154-customer-share-of-total-revenue): `SUM() OVER ()` for percent of total.

The classic "second highest salary" also lives here; see [Nth highest value](/concepts/nth-highest-value) and practise with [Top Customer(s) by Revenue (Tie-Safe)](/questions/q50-top-customer-s-by-revenue-tie-safe-interview-level).

## Skill group 5: Dates and time

Almost every business question has a time dimension. Guides: [PostgreSQL date functions](/concepts/date-functions-postgresql), [year-over-year growth](/concepts/year-over-year-growth).

- [Orders per Year and Month](/questions/q159-orders-per-year-and-month): `DATE_TRUNC` vs `EXTRACT` for bucketing.
- [Late Shipments with Days Late](/questions/q161-late-shipments-with-days-late): date subtraction and NULL shipped dates.
- [Year-over-Year Revenue Growth](/questions/q166-year-over-year-revenue-growth): `LAG` over yearly totals with `NULLIF`.
- [Customers Inactive in Last Six Months](/questions/q167-customers-inactive-in-last-six-months): `INTERVAL` arithmetic against a fixed "today".
- [First Order Month Cohort Size](/questions/q168-first-order-month-cohort-size): `MIN(order_date)` per customer, then grouping by cohort.

## Skill group 6: NULL handling and counting

NULLs cause the subtle bugs interviewers love. Guides: [NULL handling and COALESCE](/concepts/null-handling-coalesce), [COUNT(*) vs COUNT(column)](/concepts/count-star-vs-count-column).

- [Customers and Latest Order Date](/questions/q26-customers-and-latest-order-date): NULL `MAX` for customers without orders, and `NULLS LAST` sorting.
- [Customers and Average Order Value](/questions/q40-customers-and-average-order-value): avoiding divide-by-zero and NULL averages.
- [Employees Without a Manager](/questions/q61-employees-without-a-manager): `IS NULL`, never `= NULL`.
- [Unshipped Orders Older Than 30 Days](/questions/q163-unshipped-orders-older-than-30-days): NULL as a business state.

## Skill group 7: Set operators

Less common but quick wins when they appear. Guides: [UNION vs UNION ALL](/concepts/union-vs-union-all), [INTERSECT and EXCEPT](/concepts/intersect-except).

- [Customer and Supplier Contact Directory](/questions/q79-customer-and-supplier-contact-directory): stacking compatible columns from two tables.
- [Contact Directory with Type Label](/questions/q82-contact-directory-with-type-label): adding a literal column to each branch.
- [Entity Record Count Summary](/questions/q86-entity-record-count-summary): `UNION ALL` of aggregates.
- [Countries with More Customers than Employees and Suppliers](/questions/q92-countries-with-more-customers-than-employees-and-suppliers): combining sets and comparing counts.

## Skill group 8: Pivoting and conditional logic

Reporting-style questions often want categories as columns. Guide: [pivot with CASE WHEN / FILTER](/concepts/conditional-aggregation-pivot).

- [Revenue by Quarter](/questions/q160-revenue-by-quarter): one aggregate per period.
- [Orders by Day of Week](/questions/q165-orders-by-day-of-week): `EXTRACT(DOW ...)` grouped and labelled.
- [Average Days to Ship per Shipper](/questions/q162-average-days-to-ship-per-shipper): aggregating a derived date difference.

## Example

**Business question:** For each category, which two products earned the most revenue? This single question touches joins, aggregation, a CTE and a window function.

```sql
WITH product_revenue AS (
    SELECT c.category_name,
           p.product_name,
           SUM(od.unit_price * od.quantity * (1 - od.discount)) AS revenue
    FROM order_details od
    JOIN products p   ON p.product_id  = od.product_id
    JOIN categories c ON c.category_id = p.category_id
    GROUP BY c.category_name, p.product_name
),
ranked AS (
    SELECT *,
           ROW_NUMBER() OVER (PARTITION BY category_name ORDER BY revenue DESC) AS rn
    FROM product_revenue
)
SELECT category_name, product_name, ROUND(revenue::numeric, 2) AS revenue, rn
FROM ranked
WHERE rn <= 2
ORDER BY category_name, rn;
```

Illustrative result (first rows):

| category_name | product_name | revenue | rn |
|---|---|---|---|
| Beverages | Côte de Blaye | 17509.57 | 1 |
| Beverages | Ipoh Coffee | 2371.30 | 2 |
| Condiments | Northwoods Cranberry Sauce | 3148.00 | 1 |
| Condiments | Gula Malacca | 2396.24 | 2 |

In an interview, say out loud: aggregate to product grain first, rank within category, filter in the outer query, and mention that `DENSE_RANK` would keep ties.

## How to prepare

1. **Learn the schema once.** Know the join path `customers → orders → order_details → products → categories` and that revenue lives on `order_details`.
2. **Practise by pattern, not by volume.** Do 3–4 questions per skill group above until each pattern feels automatic.
3. **Write the grain first.** Before typing, state "one row per ___". It prevents most fan-out and `GROUP BY` errors.
4. **Check edge cases on purpose.** Zero-order customers, ties at the cut-off, NULL dates, first period with no previous value.
5. **Time yourself.** Aim for 10–15 minutes per medium question, including a sanity check of row counts.
6. **Explain alternatives.** Interviewers often ask "how else could you write this?": CTE vs subquery, `NOT EXISTS` vs `LEFT JOIN`, `ROW_NUMBER` vs `DENSE_RANK`.
7. **Review mistakes.** Each guide's "Common mistakes" section lists the traps that cost candidates the most points.

## Common mistakes

- Summing revenue after joining a table that multiplies rows.
- Using `INNER JOIN` when the question says "all customers" or "including those with none".
- Putting aggregates in `WHERE` or window functions in `WHERE`.
- Choosing `ROW_NUMBER` when ties should be kept.
- Grouping months by `EXTRACT(MONTH ...)` and merging years.
- `NOT IN` over a nullable subquery column.
- Integer division in percentages.

## When to use it vs alternatives

This page is a map. When a question is clearly about one pattern, go straight to the focused guide. When it combines several (most hard questions do), break it into CTE steps that each use one pattern, as in the example above.

## Interview questions

### What SQL questions are asked in data analyst interviews?
Mostly aggregation with `GROUP BY`/`HAVING`, joins (especially `LEFT JOIN` and anti joins), subqueries and CTEs, window functions for ranking and running totals, date bucketing and period comparisons, and NULL handling. Hard questions combine two or three of these.

### How many SQL questions should I practise before an interview?
Quality beats count. Working through 30–50 questions that cover every pattern above, and explaining each solution aloud, prepares you better than rushing through hundreds of similar ones.

### Are window functions required for data analyst interviews?
At most mid-level and senior analyst interviews, yes. Expect at least one ranking or period-comparison question where `ROW_NUMBER`, `RANK`, `LAG` or `SUM() OVER` is the expected answer.

### Which SQL dialect should I practise?
PostgreSQL is a safe default: it is close to the SQL standard, and the patterns transfer to MySQL, SQL Server, Snowflake and BigQuery with minor syntax changes, mainly in date functions and `LIMIT`.

### How do I avoid mistakes under time pressure?
State the output grain, build the query in CTE steps, and check row counts after each join. Then test one edge case, such as a customer with no orders, before saying you are done.

## Practice

Practice this pattern with the questions below.
