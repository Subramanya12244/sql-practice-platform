---
slug: exists-vs-in
title: SQL EXISTS vs IN (and the NOT IN NULL Trap)
description: SQL EXISTS vs IN explained with Northwind examples: semi joins, anti joins, why NOT IN returns zero rows when the subquery has a NULL, and which to use.
keywords: exists vs in sql, not exists vs not in, not in null sql, sql semi join, sql anti join, where exists subquery, in vs exists performance
questions: 28, 29, 30, 61, 62, 118, 15
related: correlated-subquery, left-join, null-handling-coalesce, intersect-except
---

`IN` and `EXISTS` both filter rows of one table by whether related rows exist in another. `IN` compares a value against a list returned by a subquery; `EXISTS` runs a correlated subquery and checks whether it returns any row at all. For positive checks they usually give the same answer, but their negated forms differ: `NOT IN` breaks when the subquery contains a NULL, while `NOT EXISTS` does not.

## Syntax

```sql
-- Semi join: rows of a that have a match in b
SELECT * FROM a WHERE a.key IN (SELECT b.key FROM b);
SELECT * FROM a WHERE EXISTS (SELECT 1 FROM b WHERE b.key = a.key);

-- Anti join: rows of a with no match in b
SELECT * FROM a WHERE a.key NOT IN (SELECT b.key FROM b);              -- NULL-unsafe
SELECT * FROM a WHERE NOT EXISTS (SELECT 1 FROM b WHERE b.key = a.key); -- NULL-safe
```

## Example

**Business question:** Which customers placed at least one order in 1998?

```sql
SELECT c.customer_id, c.company_name
FROM customers c
WHERE EXISTS (
    SELECT 1
    FROM orders o
    WHERE o.customer_id = c.customer_id
      AND o.order_date >= DATE '1998-01-01'
)
ORDER BY c.customer_id
LIMIT 5;
```

Illustrative result (32 customers in total):

| customer_id | company_name |
|---|---|
| ANATR | Ana Trujillo Emparedados |
| ANTON | Antonio Moreno Taquería |
| BERGS | Berglunds snabbköp |
| BLAUS | Blauer See Delikatessen |
| BOLID | Bólido Comidas preparadas |

Each customer appears once, even if they placed several 1998 orders. A `JOIN` would repeat them.

**The NOT IN NULL trap.** Which employees are not anyone's manager? The CEO's `reports_to` is NULL:

```sql
SELECT COUNT(*)
FROM employees
WHERE employee_id NOT IN (SELECT reports_to FROM employees);
```

Returns `0`. That is wrong: most employees manage nobody. The `NOT EXISTS` version gives the real answer:

```sql
SELECT employee_id, first_name, last_name
FROM employees e
WHERE NOT EXISTS (
    SELECT 1 FROM employees r WHERE r.reports_to = e.employee_id
)
ORDER BY employee_id;
```

| employee_id | first_name | last_name |
|---|---|---|
| 1 | Nancy | Davolio |
| 3 | Janet | Leverling |
| 4 | Margaret | Peacock |
| 6 | Michael | Suyama |
| 7 | Robert | King |
| 8 | Laura | Callahan |
| 9 | Anne | Dodsworth |

## How it works

- **`IN`** evaluates `x = v1 OR x = v2 OR ...` over the subquery's values.
- **`NOT IN`** evaluates `x <> v1 AND x <> v2 AND ...`. If any value is NULL, `x <> NULL` is UNKNOWN, so the whole `AND` chain can never be TRUE. Every row is filtered out.
- **`EXISTS`** only asks "did the subquery return a row?". It returns TRUE or FALSE, never UNKNOWN, so NULLs in `reports_to` simply fail to match and cause no harm.

You can make `NOT IN` safe by excluding NULLs, which returns the expected 7 rows:

```sql
SELECT COUNT(*)
FROM employees
WHERE employee_id NOT IN (SELECT reports_to FROM employees WHERE reports_to IS NOT NULL);
```

PostgreSQL plans `EXISTS` / `NOT EXISTS` as semi and anti joins, and usually does the same for `IN`. For `NOT IN` it cannot, because of the NULL semantics, which can also make it slower on large tables.

## Common mistakes

- **`NOT IN` over a nullable column.** One NULL makes the result empty. Prefer `NOT EXISTS`, or add `WHERE col IS NOT NULL` inside the subquery.
- **Forgetting the correlation in `EXISTS`.** `WHERE EXISTS (SELECT 1 FROM orders)` is TRUE for every row when `orders` is non-empty. The subquery must reference the outer row.
- **Using `JOIN` for a yes/no check.** A join multiplies rows when there are several matches; `EXISTS` returns each outer row once.
- **Thinking `SELECT *` in `EXISTS` is slower.** The select list is ignored; `SELECT 1` is just convention.
- **Multi-column comparisons.** `IN` needs a row constructor, `(a, b) IN (SELECT x, y ...)`; `EXISTS` handles it with ordinary `AND` conditions.

## When to use it vs alternatives

| Need | Recommended |
|---|---|
| Rows with a match, small fixed list | `IN ('A', 'B', 'C')` |
| Rows with a match in another table | `EXISTS` or `IN`; both fine |
| Rows with no match | `NOT EXISTS`, or `LEFT JOIN ... WHERE b.key IS NULL` |
| Need columns from the other table | `JOIN` |
| Set difference of whole rows | `EXCEPT`; see [INTERSECT and EXCEPT](/concepts/intersect-except) |

See [LEFT JOIN](/concepts/left-join) for the anti-join version and [correlated subqueries](/concepts/correlated-subquery) for how `EXISTS` evaluates per row.

## Interview questions

### What is the difference between EXISTS and IN?
`IN` checks whether a value is in the set returned by a subquery. `EXISTS` checks whether a correlated subquery returns any row. For positive checks the results match; the difference shows with NULLs and `NOT`.

### Why does NOT IN return no rows when the subquery has a NULL?
`x NOT IN (1, NULL)` means `x <> 1 AND x <> NULL`. The second comparison is UNKNOWN, so the expression is never TRUE and every row is filtered out. Use `NOT EXISTS` or filter NULLs from the subquery.

### Is EXISTS faster than IN?
In modern PostgreSQL they usually produce the same semi-join plan. `NOT EXISTS` is often faster than `NOT IN` because it can be planned as an anti join. Write for correctness first.

### How do you find customers who never placed an order?
`WHERE NOT EXISTS (SELECT 1 FROM orders o WHERE o.customer_id = c.customer_id)`, or a `LEFT JOIN` filtered on `o.order_id IS NULL`. Both are NULL-safe; that is [Customers with No Orders](/questions/q28-customers-with-no-orders).

## Practice

Practice this pattern with the questions below.
