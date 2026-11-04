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

---

# Data engineering content (DataForge Phase 3)

The registry of tracks, topic slugs and project slugs is `frontend/src/site/content/tracks.json`. Use those slugs exactly, and only link to slugs that are in it (or to the existing SQL notes and patterns).

## Track notes: `content/notes/<track>/<slug>.md` → `/notes/<slug>`

The track ids are `python`, `etl`, `warehousing`, `spark`, `airflow`, `dbt` and `cloud`. The frontmatter is the same as for SQL notes, with these differences:
- `category` must equal the track id.
- `questions` is usually empty.
- There is one extra field, `projects: [project slugs]`.

Use exactly these `##` headings, in this order:
1. `## Introduction`
2. `## Definition`
3. `## Why it matters`
4. `## How it works`
5. `## Syntax and configuration`: code or config blocks
6. `## Examples`
7. `## Architecture`: at least one ```mermaid block
8. `## Practical example`
9. `## Exercises`: 2–4 numbered exercises, each with a short answer in a `<details>` element
10. `## Common mistakes`
11. `## Performance and best practices`
12. `## Interview questions`: 3–5 items, each a `### Question?` followed by its answer. These become flashcards automatically.
13. `## Quick revision`: 4–8 bullets

### Code blocks

| Tag | Rule |
|---|---|
| `python` | Must run as-is with Python 3.9+ using only the standard library plus pandas and numpy, finish in under 5 seconds, and need no network or files outside a temp directory. CI runs every one (`scripts/check_python_blocks.py`). |
| `python-syntax` | Not executed. For Spark, Airflow, boto3, requests and similar. |
| `sql` | Must run on Northwind, under the same rules as the SQL notes. |
| `sql-syntax` | Not executed. |
| `yaml`, `bash`, `jinja`, `json`, `text` | Not executed. |

### Mermaid diagrams

Keep ```mermaid diagrams small:
- use `flowchart LR` or `flowchart TD`
- write node ids as plain words, with labels in `["…"]`
- no styling or HTML, and no `click` directives

Every diagram must also be understandable from the text around it.

## Track mind maps: `content/mindmaps/<track>-track.json`

Use the same format as the other mind maps. Each node's `note` must be a topic slug from that track (or an existing note), and maps have 15–45 nodes.

## Projects: `content/projects/<slug>.md` → `/projects-lab/<slug>`

```yaml
---
title: CSV to PostgreSQL ETL pipeline
slug: csv-to-postgres-etl
level: Beginner            # Beginner | Intermediate | Advanced
description: ≤155 chars
technologies: [Python, PostgreSQL]
dataset: sales             # dataset used by the sql tasks: northwind | hr | sales | ecommerce | banking | inventory
prerequisites: [python-csv-json, etl-loading]   # note slugs
minutes: 90
---
```

The body uses these headings, in order:
1. `## Business problem`
2. `## Learning objectives`
3. `## Architecture`: a mermaid block
4. `## Technologies`
5. `## Dataset`
6. `## Tasks`: an intro, then task blocks
7. `## Expected output`
8. `## Common mistakes`
9. `## Interview discussion questions`: `### Q` followed by its answer
10. `## Summary`

### Task blocks

Each task is a fenced block tagged `task` that contains one JSON object:

```json
{"id": "stage-orders", "title": "Load orders into a staging table", "type": "sql",
 "instructions": "Markdown. What to build and the exact names to use.",
 "starter": "-- SQL the learner starts from",
 "solution": "-- reference SQL that passes",
 "check": "SELECT (COUNT(*) = 500) AS ok, 'staging_orders should have 500 rows' AS message FROM staging_orders"}
```

There are three task types:
- **`sql`**:
  - The learner's SQL runs, then the `check` runs, all inside one rolled-back transaction on `dataset`.
  - The check must return exactly one row with a boolean `ok` and a text `message`.
  - `solution` must pass and `starter` must fail.
- **`python`**:
  - `starter`, `solution` and `tests` are Python source.
  - The tests are `assert` statements that run after the learner's code in the same namespace.
  - Inputs come from inline strings or `io.StringIO`, never from real files or the network.
  - The standard library, pandas and numpy are allowed.
  - `solution` must pass the tests and `starter` must fail them.
- **`checklist`**:
  - `"items": ["…"]` lists manual steps that can't be verified in the browser (for example, running Airflow locally).
  - A project with checklist tasks can reach **Submitted**, but never **Completed**, on checklist ticks alone.

## Python exercises: `content/python/<slug>.md` → `/practice/python/<slug>`

Frontmatter fields are `title`, `slug`, `difficulty`, `description`, `topic` (a python-track note slug) and `minutes`. The body has three sections, then a single python `task` block:
- `## Problem`
- `## Examples`: input/output examples
- `## Hints`: 2–3 bullets
