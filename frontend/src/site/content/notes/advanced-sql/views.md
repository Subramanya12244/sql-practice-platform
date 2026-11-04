---
title: Views
slug: views
category: advanced-sql
difficulty: Intermediate
description: Save a query as a named virtual table with CREATE VIEW, and learn updatable views, materialized views and when each is the right choice.
prerequisites: [select, inner-join, group-by]
related: [cte, temporary-tables, query-optimization, database-design]
questions: [1, 3, 31, 141]
patterns: []
guides: [cte]
minutes: 8
version: 1
---

## Introduction

The same revenue join appears in dozens of reports. A view gives it a name so every query reads `FROM customer_revenue` instead of repeating four joins.

## Definition

A view is a stored `SELECT` that behaves like a table. It holds no data: each query against it runs the underlying query. A materialized view (PostgreSQL, Oracle; "indexed view" in SQL Server) stores the result and must be refreshed.

## Why it matters

- One definition of a business metric, reused everywhere.
- Hides complexity and columns (security: grant on the view, not the tables).
- Stable interface while base tables change.
- Interview favourite: view vs materialized view vs CTE vs temp table.

## How it works

- `CREATE VIEW v AS SELECT ...` stores the query text (parsed).
- At query time the planner inlines the view, so filters on the view can be pushed into it.
- A simple view (one table, no aggregates/DISTINCT/GROUP BY/LIMIT) is automatically updatable in PostgreSQL.
- `WITH CHECK OPTION` rejects inserts/updates through the view that would fall outside its `WHERE`.

## Syntax

```sql-syntax
CREATE [OR REPLACE] [TEMP] VIEW view_name AS
SELECT ...;

CREATE MATERIALIZED VIEW mv_name AS SELECT ...;
REFRESH MATERIALIZED VIEW [CONCURRENTLY] mv_name;

DROP VIEW [IF EXISTS] view_name;
```

## Simple examples

A revenue-per-line view, then queried like a table:

```sql
CREATE VIEW order_line_revenue AS
SELECT od.order_id, od.product_id, o.customer_id, o.order_date,
       od.unit_price * od.quantity * (1 - od.discount) AS revenue
FROM order_details od
JOIN orders o ON o.order_id = od.order_id;

SELECT customer_id, ROUND(SUM(revenue)::numeric, 2) AS total
FROM order_line_revenue
GROUP BY customer_id
ORDER BY total DESC
LIMIT 5;
```

## Intermediate examples

Views stack. Build an aggregate view on top of another:

```sql
CREATE VIEW order_line_revenue AS
SELECT od.order_id, o.customer_id,
       od.unit_price * od.quantity * (1 - od.discount) AS revenue
FROM order_details od JOIN orders o ON o.order_id = od.order_id;

CREATE VIEW customer_revenue AS
SELECT c.customer_id, c.company_name,
       COALESCE(SUM(r.revenue), 0) AS revenue
FROM customers c
LEFT JOIN order_line_revenue r ON r.customer_id = c.customer_id
GROUP BY c.customer_id, c.company_name;

SELECT * FROM customer_revenue WHERE revenue = 0;
```

## Advanced examples

An updatable view with `WITH CHECK OPTION`:

```sql
CREATE VIEW active_products AS
SELECT product_id, product_name, unit_price, discontinued
FROM products
WHERE discontinued = false
WITH CHECK OPTION;

UPDATE active_products SET unit_price = unit_price + 1
WHERE product_id = 1
RETURNING product_id, product_name, unit_price;
```

Trying `UPDATE active_products SET discontinued = true WHERE product_id = 1` fails: the row would leave the view.

Materialized view, indexed and refreshed:

```sql
CREATE MATERIALIZED VIEW monthly_revenue AS
SELECT DATE_TRUNC('month', o.order_date)::date AS month,
       SUM(od.unit_price * od.quantity * (1 - od.discount)) AS revenue
FROM orders o JOIN order_details od ON od.order_id = o.order_id
GROUP BY 1;

CREATE UNIQUE INDEX ON monthly_revenue (month);
REFRESH MATERIALIZED VIEW CONCURRENTLY monthly_revenue;

SELECT month, ROUND(revenue::numeric, 2) AS revenue
FROM monthly_revenue ORDER BY month LIMIT 6;
```

## Real-world scenarios

- A `reporting` schema of views for BI tools.
- Row/column security: expose `customers_public` without contact details.
- Materialized views for expensive dashboards refreshed nightly.
- Renaming/refactoring tables while keeping old names as views.

## PostgreSQL specifics

- Views are expanded by the rule system; no performance penalty versus writing the query inline.
- `CREATE OR REPLACE VIEW` can only add columns at the end and cannot change existing column types.
- `REFRESH ... CONCURRENTLY` needs a unique index and avoids blocking readers.
- `security_barrier` and `security_invoker` (PostgreSQL 15+) control how views interact with row-level security.
- Complex views can be made writable with `INSTEAD OF` triggers.

## Visual explanation

```text
query:  SELECT * FROM customer_revenue WHERE revenue = 0
            |
            v  planner inlines the definition
SELECT ... FROM customers c LEFT JOIN (order_details JOIN orders) ...
GROUP BY ... HAVING/WHERE revenue = 0
            |
            v  runs on base tables every time  (view)
               or reads stored rows           (materialized view)
```

## Common mistakes

- Assuming a view caches results. Only materialized views do.
- `SELECT *` in a view: PostgreSQL expands it at creation time, so new base columns do not appear.
- Deep stacks of views hiding expensive joins nobody remembers.
- Forgetting to refresh a materialized view and reporting stale data.

## Performance

- A plain view costs the same as its query. Optimise the underlying query.
- Filters usually push down into simple views, but not always through aggregates, window functions or `DISTINCT`.
- Materialized views trade freshness for speed; index them like tables.

## Interview questions

### View vs materialized view?

A view stores only the query and always returns current data. A materialized view stores the result, is fast to read, can be indexed, and is stale until `REFRESH`.

### View vs CTE?

A CTE lives for one statement. A view is a schema object reused by many queries and users.

### Can you update through a view?

In PostgreSQL, yes for simple single-table views without aggregates, `DISTINCT`, `GROUP BY`, `LIMIT` or set operations. Others need `INSTEAD OF` triggers.

### What does WITH CHECK OPTION do?

It rejects inserts or updates through the view that would produce rows the view's `WHERE` would not show.

## Quick revision

- View = saved query, no data.
- Materialized view = saved result, needs `REFRESH`.
- Simple views are auto-updatable in PostgreSQL.
- `WITH CHECK OPTION` keeps writes inside the view.
- `SELECT *` is frozen at creation.
- Good for reuse, security and stable interfaces.
