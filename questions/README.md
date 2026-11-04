# Questions

Questions are stored as version-controlled JSON.

## Format

```json
{
  "questions": [
    {
      "question_number": 91,
      "title": "...",
      "description": "...",
      "business_problem": "...",
      "requirements": ["..."],
      "difficulty": "Advanced",
      "topic": "CONDITIONAL AGGREGATION",
      "subtopic": null,
      "tables_used": ["customers", "suppliers"],
      "reference_query": "SELECT ...",
      "expected_columns": ["country", "customer_count"],
      "expected_result": null,
      "sort_required": true,
      "starter_sql": "",
      "hints": []
    }
  ]
}
```

`reference_query` is used only on the backend for grading and is **never** returned by the public question API.

## Import from northwind-sql-practice

```bash
python build_questions.py
```

This reads `../northwind-sql-practice/**/Q*.md` + matching `.sql` files and regenerates `questions.json`.

## GitHub sync

Configure `GITHUB_REPOSITORY` and `GITHUB_TOKEN` on the backend, then call `POST /api/github/sync` or use the UI Sync button.
