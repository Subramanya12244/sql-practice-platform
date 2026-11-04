---
title: JSONB
slug: jsonb
category: advanced-sql
difficulty: Advanced
description: Build, query, index and unnest JSON documents in PostgreSQL with jsonb, ->, ->>, @>, jsonb_agg and jsonb_array_elements.
prerequisites: [select, group-by, string-functions]
related: [indexes, normalization, database-design, cte]
questions: [125, 141]
patterns: []
guides: []
minutes: 10
version: 1
---

## Introduction

APIs speak JSON. PostgreSQL can produce JSON from tables, store it in a column and query inside it. `jsonb` is the type to use.

## Definition

`jsonb` is PostgreSQL's binary JSON type. It stores parsed JSON, removes duplicate keys, does not keep key order or whitespace, and supports indexing and containment operators. The older `json` type stores the raw text.

## Why it matters

- Returning nested API responses straight from SQL.
- Storing semi-structured attributes (settings, event payloads) that vary per row.
- Interviewers ask `json` vs `jsonb`, `->` vs `->>`, and when JSON columns are a design smell.

## How it works

- Build: `jsonb_build_object(k, v, ...)`, `to_jsonb(row)`, `jsonb_agg(expr)`.
- Navigate: `->` returns `jsonb`, `->>` returns `text`, `#>`/`#>>` take a path array.
- Test: `@>` contains, `?` key exists, `?|`/`?&` any/all keys.
- Unnest: `jsonb_array_elements`, `jsonb_each`, `jsonb_to_recordset`.
- Modify: `||` merges, `-` removes a key, `jsonb_set` replaces a path.

## Syntax

```sql-syntax
jsonb_build_object('key', value, ...)
to_jsonb(table_alias)
jsonb_agg(expr ORDER BY ...)
doc -> 'key'          -- jsonb
doc ->> 'key'         -- text
doc #>> '{a,b}'       -- text at path
doc @> '{"k": "v"}'   -- containment
jsonb_array_elements(doc -> 'items')
jsonb_set(doc, '{path}', new_value)
```

## Simple examples

Build one JSON object per product:

```sql
SELECT jsonb_build_object(
         'id', product_id,
         'name', product_name,
         'price', unit_price,
         'in_stock', units_in_stock > 0) AS doc
FROM products
ORDER BY product_id
LIMIT 3;
```

Whole row as JSON, then read fields back (`->>` gives text, so cast for numbers):

```sql
WITH docs AS (SELECT to_jsonb(c) AS doc FROM customers c)
SELECT doc ->> 'customer_id' AS id,
       doc ->> 'company_name' AS company,
       doc -> 'country'        AS country_jsonb
FROM docs
WHERE doc ->> 'country' = 'Germany';
```

## Intermediate examples

Nested document: each order with an array of its lines.

```sql
SELECT jsonb_build_object(
         'order_id', o.order_id,
         'customer', o.customer_id,
         'lines', jsonb_agg(jsonb_build_object(
                    'product_id', od.product_id,
                    'qty', od.quantity,
                    'price', od.unit_price) ORDER BY od.product_id)) AS order_doc
FROM orders o
JOIN order_details od ON od.order_id = o.order_id
GROUP BY o.order_id, o.customer_id
ORDER BY o.order_id
LIMIT 3;
```

Containment filter with `@>`:

```sql
WITH docs AS (
  SELECT jsonb_build_object('id', product_id, 'name', product_name,
                            'discontinued', discontinued) AS doc
  FROM products
)
SELECT doc ->> 'name' AS name
FROM docs
WHERE doc @> '{"discontinued": true}';
```

## Advanced examples

Round trip: build documents, unnest the array, aggregate again.

```sql
WITH order_docs AS (
  SELECT o.order_id,
         jsonb_agg(jsonb_build_object('qty', od.quantity, 'price', od.unit_price)) AS lines
  FROM orders o JOIN order_details od ON od.order_id = o.order_id
  GROUP BY o.order_id
)
SELECT d.order_id,
       jsonb_array_length(d.lines) AS line_count,
       SUM((l ->> 'qty')::int * (l ->> 'price')::numeric) AS gross
FROM order_docs d
CROSS JOIN LATERAL jsonb_array_elements(d.lines) AS l
GROUP BY d.order_id, d.lines
ORDER BY gross DESC
LIMIT 5;
```

Store JSONB in a temp table, index it with GIN and update a key:

```sql
CREATE TEMP TABLE product_docs AS
SELECT product_id, to_jsonb(p) - 'quantity_per_unit' AS doc FROM products p;
CREATE INDEX ON product_docs USING GIN (doc jsonb_path_ops);
UPDATE product_docs
SET doc = jsonb_set(doc, '{unit_price}', to_jsonb(ROUND((doc ->> 'unit_price')::numeric * 1.1, 2)))
WHERE doc @> '{"category_id": 1}';
SELECT doc ->> 'product_name' AS name, doc -> 'unit_price' AS new_price
FROM product_docs
WHERE doc @> '{"category_id": 1}'
ORDER BY product_id;
```

## Real-world scenarios

- API endpoints returning nested orders without an ORM.
- Event/audit logs with varying payloads.
- Product attributes that differ per category (size, colour, voltage).
- Flattening imported JSON into relational tables with `jsonb_to_recordset`.

## PostgreSQL specifics

- `json` keeps text as-is (duplicates, order); `jsonb` is parsed, deduplicated, indexable. Prefer `jsonb`.
- GIN `jsonb_ops` (default) supports `@>`, `?`, `?|`, `?&`; `jsonb_path_ops` is smaller and supports `@>` (and jsonpath match operators) only.
- SQL/JSON path: `jsonb_path_query`, `@?`, `@@`. PostgreSQL 16 adds `IS JSON` and `JSON_ARRAY`/`JSON_OBJECT` constructors; `JSON_TABLE` arrives in 17.
- Other databases differ: MySQL has `JSON` with `->`/`->>`, SQL Server stores JSON in `nvarchar` with `JSON_VALUE`.

## Visual explanation

```text
doc = {"id": 1, "name": "Chai", "tags": ["tea", "drink"]}

doc -> 'name'         "Chai"      (jsonb, quoted)
doc ->> 'name'        Chai        (text)
doc -> 'tags' -> 0    "tea"       (jsonb)
doc #>> '{tags,1}'    drink       (text)
doc @> '{"id": 1}'    true
doc ? 'price'         false
```

## Common mistakes

- Comparing `doc -> 'price' > 10`: `->` returns jsonb. Use `(doc ->> 'price')::numeric`.
- Putting core, frequently joined fields (customer_id, dates) inside JSON instead of columns.
- Expecting a GIN index to speed up `doc ->> 'k' = 'v'`; it serves `@>`. Use an expression B-tree index for `->>` equality.
- Forgetting `jsonb_agg` needs `GROUP BY` and returns NULL (not `[]`) for no rows; wrap with `COALESCE(..., '[]')`.

## Performance

- GIN on the column for containment/key-exists queries.
- B-tree expression index `((doc ->> 'sku'))` for equality/range on one key.
- Large documents are TOASTed; any update rewrites the whole value, so hot-updated fields belong in normal columns.

## Interview questions

### `json` vs `jsonb`?

`json` stores exact text and re-parses on each access. `jsonb` stores a parsed binary form, drops duplicate keys and key order, and supports GIN indexes and containment. Use `jsonb` unless you must keep the original text.

### `->` vs `->>`?

`->` returns `jsonb` (chainable). `->>` returns `text` (for comparisons and casting).

### How do you index JSONB?

GIN for `@>`/`?` across many keys; expression B-tree for a single frequently filtered key.

### When should you not use JSONB?

When the attributes are known, queried, joined or constrained. Columns give types, constraints, foreign keys and better statistics.

## Quick revision

- Use `jsonb`, not `json`.
- Build with `jsonb_build_object`, `to_jsonb`, `jsonb_agg`.
- `->` jsonb, `->>` text; cast before comparing numbers.
- `@>` containment + GIN index.
- Unnest with `jsonb_array_elements` via `LATERAL`.
- Keep core relational fields as columns.
