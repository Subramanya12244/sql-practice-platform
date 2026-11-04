# Learning content specification

All learning content for the public site lives in `frontend/src/site/content/` as Markdown or JSON.
Pages render it with shared components. Automated tests (`frontend/src/test/siteContent.test.ts`) check:
- every reference points to something that exists
- every runnable SQL block runs on the browser Northwind database

## Shared rules

- **Dialect:** PostgreSQL 16. When a behaviour is PostgreSQL-specific, say so, e.g. "In PostgreSQL…" or "Standard SQL has no…". Never present one database's behaviour as universal.
- **Data:** use only the Northwind schema in `database/schema.sql`. This copy of Northwind is small and synthetic:
  - 100 orders, dated 1996-01-01 to 1998-12-28
  - empty `region`, `phone`, `address` and `quantity_per_unit` columns
  - `units_on_order` is 0 everywhere
  - one order has a NULL `employee_id`
  - customers FISSA and PARIS have no orders
  - products 9 and 17 were never ordered
- **Runnable SQL** goes in fenced blocks tagged `sql`. Each one must run without error on Northwind and return at least one row:
  - run it with `/opt/homebrew/opt/postgresql@16/bin/psql -d northwind -c "BEGIN; <sql>; ROLLBACK;"`
  - for statements that change data, end with `RETURNING` or a trailing `SELECT`
- **Syntax templates** (placeholders such as `table_name`, or other dialects) go in fenced blocks tagged `sql-syntax`. They are highlighted but never executed.
- **Result tables** must be copied from real psql output. Otherwise leave them out.
- **Style:** concise, practical and interview-oriented. No filler.

## Theory notes: `content/notes/<category>/<slug>.md` → `/notes/<slug>`

Categories, in order: `fundamentals`, `joins`, `aggregations`, `subqueries`, `ctes`, `window-functions`, `set-operators`, `advanced-sql`.

Frontmatter:

```yaml
---
title: LEFT JOIN
slug: left-join                  # globally unique across all notes
category: joins
difficulty: Beginner             # Beginner | Intermediate | Advanced | Expert
description: One sentence, at most 155 characters, used for SEO.
prerequisites: [inner-join]      # note slugs
related: [right-join, full-outer-join, exists-not-exists]   # note slugs
questions: [25, 28, 29]          # question numbers from frontend/public/data/index.json (2–6 where sensible)
patterns: [anti-join]            # pattern slugs (may be empty)
guides: [left-join]              # existing concept guide slugs in content/concepts (may be empty)
minutes: 8                       # estimated reading time
version: 1
---
```

The body uses exactly these `##` headings, in this order. Omit a section only when it truly does not apply.
1. `## Introduction`
2. `## Definition`
3. `## Why it matters`
4. `## How it works`
5. `## Syntax`: a `sql-syntax` block
6. `## Simple examples`
7. `## Intermediate examples`
8. `## Advanced examples`
9. `## Real-world scenarios`
10. `## PostgreSQL specifics`
11. `## Visual explanation`: an ASCII diagram in a `text` block, or a small table
12. `## Common mistakes`
13. `## Performance`
14. `## Interview questions`: 3–5 items, each a `### Question?` followed by its answer
15. `## Quick revision`: 4–8 bullets

The page itself renders the related exercises, related concepts, patterns and guides from the frontmatter. Don't write those sections in the body.

## Patterns: `content/patterns/<slug>.md` → `/patterns/<slug>`

```yaml
---
title: Top N per group
slug: top-n-per-group
category: ranking               # dedup | missing | ranking | latest | running | dates | growth | reshape | hierarchy
difficulty: Intermediate
description: ≤155 chars.
questions: [14, 100]
notes: [row-number, partition-by]     # note slugs
guides: [top-n-per-group]             # concept guide slugs (may be empty)
---
```

The body uses these headings, in order:
1. `## Problem`
2. `## When to use it`
3. `## Solution`: a runnable `sql` block
4. `## Alternatives`: one or more runnable `sql` blocks with trade-offs
5. `## How it works`
6. `## Execution walkthrough`: numbered steps, optionally with real intermediate rows
7. `## Common mistakes`
8. `## Performance`

## Shortcuts: `content/shortcuts/<category>.json` → `/shortcuts`

```json
{
  "category": "joins",
  "title": "JOINs",
  "order": 3,
  "items": [
    {
      "id": "left-join-keep-all",
      "operation": "Keep every left row",
      "syntax": "SELECT … FROM a LEFT JOIN b ON b.key = a.key",
      "explanation": "Rows from a without a match get NULLs for b's columns.",
      "example": "SELECT c.customer_id, o.order_id FROM customers c LEFT JOIN orders o ON o.customer_id = c.customer_id LIMIT 5;",
      "expected": "One row per customer/order pair, plus customers with no orders (order_id NULL).",
      "notes": ["left-join"]
    }
  ]
}
```

- `example` must be runnable on Northwind.
- The categories are: `basics`, `filtering`, `joins`, `aggregations`, `subqueries`, `ctes`, `window-functions`, `set-operators`, `dates`, `strings`, `nulls`, `postgresql`, `optimization`.

Two more Markdown pages sit alongside the JSON files:
- `content/shortcuts/comparisons.md`: one `##` section per comparison, each with a table and a runnable example where meaningful.
- `content/shortcuts/interview-revision.md`: a one-page interview quick revision.

## Mind maps: `content/mindmaps/<slug>.json` → `/mindmaps/<slug>`

```json
{
  "slug": "joins",
  "title": "SQL JOINs",
  "description": "≤155 chars",
  "root": {
    "id": "joins",
    "label": "JOINs",
    "note": "inner-join",
    "children": [
      { "id": "inner", "label": "INNER JOIN", "note": "inner-join", "questions": [41], "prereq": [], "children": [] }
    ]
  }
}
```

- Node `id`s are unique within a map.
- `note` is a note slug and `pattern` a pattern slug; both are optional.
- `questions` holds question numbers, and `prereq` holds other node ids in the same map.
- Keep each map to 15–45 nodes and at most 4 levels deep.
