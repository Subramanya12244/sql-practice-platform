---
title: SQL Window Functions
slug: window-functions
order: 14
level: Advanced
description: Learn SQL window functions on Northwind: ROW_NUMBER, RANK, DENSE_RANK, LAG, LEAD, running totals, moving averages and PARTITION BY.
related: [q99-rank-vs-dense-rank-product-prices, q100-top-3-products-by-revenue-per-category, q101-running-total-of-monthly-revenue, q103-month-over-month-revenue-change, q105-customer-share-of-total-revenue]
---

A window function computes a value for each row using a set of related rows (the window) without collapsing them like `GROUP BY` does.

## Syntax

```sql
function(...) OVER (
    [PARTITION BY grp]
    [ORDER BY col]
    [ROWS BETWEEN n PRECEDING AND CURRENT ROW]
)
```

- Ranking: `ROW_NUMBER()`, `RANK()`, `DENSE_RANK()`, `NTILE(n)`, `PERCENT_RANK()`.
- Offset: `LAG(x)`, `LEAD(x)`, `FIRST_VALUE(x)`, `LAST_VALUE(x)`.
- Aggregates as windows: `SUM(x) OVER (...)`, `AVG(x) OVER (...)`.

## Examples

**Rank products by price within each category:**

```sql
SELECT category_id, product_name, unit_price,
       RANK() OVER (PARTITION BY category_id ORDER BY unit_price DESC) AS price_rank
FROM products;
```

**Running total of monthly revenue:**

```sql
WITH monthly AS (
    SELECT DATE_TRUNC('month', o.order_date)::date AS month,
           SUM(od.unit_price * od.quantity * (1 - od.discount)) AS revenue
    FROM orders o
    JOIN order_details od ON od.order_id = o.order_id
    GROUP BY 1
)
SELECT month, ROUND(revenue::numeric, 2) AS revenue,
       ROUND(SUM(revenue) OVER (ORDER BY month)::numeric, 2) AS running_total
FROM monthly
ORDER BY month;
```

**Gap between a customer's consecutive orders:**

```sql
SELECT customer_id, order_id, order_date,
       order_date - LAG(order_date) OVER (PARTITION BY customer_id ORDER BY order_date, order_id) AS days_since_prev
FROM orders;
```

## Common mistakes

- Filtering on a window result in `WHERE`. Windows run after `WHERE`; wrap the query in a CTE and filter outside.
- `LAST_VALUE` with the default frame returns the current row. Use `ROWS BETWEEN UNBOUNDED PRECEDING AND UNBOUNDED FOLLOWING`.
- `ROW_NUMBER` on tied values is arbitrary unless you add a tie-breaker to `ORDER BY`.

## Exercises

```exercise
prompt: Number products within each category from most to least expensive (ties broken by product_name). Return category_id, product_name, unit_price, rn.
orderBy: category_id, rn
---
SELECT category_id, product_name, unit_price, ROW_NUMBER() OVER (PARTITION BY category_id ORDER BY unit_price DESC, product_name) AS rn FROM products ORDER BY category_id, rn;
```

```exercise
prompt: Return the most expensive product per category using ROW_NUMBER (tie-break on product_name). Return category_id, product_name, unit_price.
orderBy: category_id
---
WITH r AS (SELECT category_id, product_name, unit_price, ROW_NUMBER() OVER (PARTITION BY category_id ORDER BY unit_price DESC, product_name) AS rn FROM products) SELECT category_id, product_name, unit_price FROM r WHERE rn = 1 ORDER BY category_id;
```

```exercise
prompt: For each order show order_id, freight and the running total of freight ordered by order_id (column running_freight).
orderBy: order_id
---
SELECT order_id, freight, SUM(freight) OVER (ORDER BY order_id) AS running_freight FROM orders ORDER BY order_id;
```

```exercise
prompt: Show each product's unit_price alongside its category's average price (avg_price, rounded to 2). Return product_name, category_id, unit_price, avg_price.
---
SELECT product_name, category_id, unit_price, ROUND(AVG(unit_price) OVER (PARTITION BY category_id), 2) AS avg_price FROM products;
```
