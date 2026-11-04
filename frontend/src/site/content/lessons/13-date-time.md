---
title: SQL Date and Time Functions
slug: date-time
order: 13
level: Intermediate
description: Work with dates in PostgreSQL: EXTRACT, DATE_TRUNC, intervals, date arithmetic, AGE and TO_CHAR, with Northwind order and shipping examples.
related: [q159-orders-per-year-and-month, q160-revenue-by-quarter, q161-late-shipments-with-days-late, q162-average-days-to-ship-per-shipper, q165-orders-by-day-of-week]
---

Northwind stores `order_date`, `required_date`, `shipped_date`, `birth_date` and `hire_date` as `DATE`. PostgreSQL gives you a rich toolkit for slicing and computing with them.

## Syntax

```sql
EXTRACT(YEAR FROM d)           -- also MONTH, DAY, DOW, QUARTER
DATE_TRUNC('month', d)         -- first instant of the month (timestamp)
d2 - d1                        -- DATE minus DATE = integer days
d + INTERVAL '7 days'          -- date arithmetic
AGE(d2, d1)                    -- interval in years/months/days
TO_CHAR(d, 'YYYY-MM')          -- format as text
CURRENT_DATE, NOW()
```

## Examples

**Orders per year and month:**

```sql
SELECT EXTRACT(YEAR FROM order_date) AS yr,
       EXTRACT(MONTH FROM order_date) AS mon,
       COUNT(*) AS orders
FROM orders
GROUP BY yr, mon
ORDER BY yr, mon;
```

**Days late for late shipments:**

```sql
SELECT order_id, required_date, shipped_date,
       shipped_date - required_date AS days_late
FROM orders
WHERE shipped_date > required_date;
```

**Employee age at hire:**

```sql
SELECT last_name, AGE(hire_date, birth_date) AS age_at_hire
FROM employees;
```

## Common mistakes

- `DATE_TRUNC` returns a timestamp; cast with `::date` if you want a date.
- `BETWEEN '1997-01-01' AND '1997-12-31'` on timestamp columns misses times on Dec 31. Prefer `>= start AND < next_start`.
- `EXTRACT(DOW ...)` is 0 for Sunday; `ISODOW` is 7 for Sunday.
- Applying functions to a column in `WHERE` (e.g. `EXTRACT(YEAR FROM order_date) = 1997`) prevents a plain index on it from being used.

## Exercises

```exercise
prompt: Count orders per year. Return yr and order_count.
orderBy: yr
---
SELECT EXTRACT(YEAR FROM order_date) AS yr, COUNT(*) AS order_count FROM orders GROUP BY yr ORDER BY yr;
```

```exercise
prompt: Return order_id and days_to_ship (shipped_date minus order_date) for every shipped order.
---
SELECT order_id, shipped_date - order_date AS days_to_ship FROM orders WHERE shipped_date IS NOT NULL;
```

```exercise
prompt: Count orders per month using DATE_TRUNC. Return month (as a date) and order_count.
orderBy: month
---
SELECT DATE_TRUNC('month', order_date)::date AS month, COUNT(*) AS order_count FROM orders GROUP BY 1 ORDER BY 1;
```

```exercise
prompt: List employees hired in 1993 or later. Return first_name, last_name, hire_date.
---
SELECT first_name, last_name, hire_date FROM employees WHERE hire_date >= DATE '1993-01-01';
```
