---
title: SQL String Functions in PostgreSQL
slug: string-functions
order: 12
level: Intermediate
description: Use PostgreSQL string functions: concatenation, UPPER/LOWER, LENGTH, SUBSTRING, POSITION, REPLACE, TRIM, SPLIT_PART and STRING_AGG on Northwind.
related: [q79-customer-and-supplier-contact-directory, q83-master-contact-directory, q70-customers-sharing-the-same-postal-code]
---

String functions clean, reshape and combine text. These are the ones you reach for most in PostgreSQL.

| Function | Example | Result |
|---|---|---|
| `a \|\| b` / `concat(a, b)` | `'ab' \|\| 'c'` | `abc` |
| `upper`, `lower`, `initcap` | `upper('ab')` | `AB` |
| `length(s)` | `length('abc')` | `3` |
| `substring(s from 1 for 3)` / `left(s, n)` | `left('Chai', 2)` | `Ch` |
| `position('a' in s)` | `position('a' in 'Chai')` | `3` |
| `replace(s, from, to)` | `replace('a-b', '-', ' ')` | `a b` |
| `trim(s)` | `trim('  x ')` | `x` |
| `split_part(s, delim, n)` | `split_part('a b', ' ', 2)` | `b` |
| `string_agg(s, sep ORDER BY ...)` | aggregate | joined text |

## Examples

**Full employee names:**

```sql
SELECT title_of_courtesy || ' ' || first_name || ' ' || last_name AS full_name
FROM employees;
```

**First word of a product name and its length:**

```sql
SELECT product_name,
       split_part(product_name, ' ', 1) AS first_word,
       length(product_name) AS name_length
FROM products;
```

**Comma-separated product list per category:**

```sql
SELECT category_id, string_agg(product_name, ', ' ORDER BY product_name) AS products
FROM products
GROUP BY category_id;
```

## Common mistakes

- `||` with a NULL operand yields NULL; `concat()` treats NULL as empty.
- String positions start at 1, not 0.
- `length` on `char(n)` ignores trailing spaces; on `varchar` it does not.

## Exercises

```exercise
prompt: Return each employee's full name as first_name, a space, then last_name, in a column named full_name.
---
SELECT first_name || ' ' || last_name AS full_name FROM employees;
```

```exercise
prompt: List products whose name is longer than 25 characters. Return product_name and name_length.
---
SELECT product_name, length(product_name) AS name_length FROM products WHERE length(product_name) > 25;
```

```exercise
prompt: For each category_id return an alphabetical, comma-and-space separated list of its product names in a column products.
orderBy: category_id
---
SELECT category_id, string_agg(product_name, ', ' ORDER BY product_name) AS products FROM products GROUP BY category_id ORDER BY category_id;
```

```exercise
prompt: Show customer company names in upper case along with the first 3 letters of their country. Return company_upper and country_code.
---
SELECT upper(company_name) AS company_upper, left(country, 3) AS country_code FROM customers;
```
