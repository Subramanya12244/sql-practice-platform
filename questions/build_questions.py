#!/usr/bin/env python3
"""Convert northwind-sql-practice markdown/SQL pairs into questions.json."""

from __future__ import annotations

import json
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT.parent / "northwind-sql-practice"
OUT = ROOT / "questions" / "questions.json"

DIFFICULTY_MAP = {
    "easy": "Beginner",
    "beginner": "Beginner",
    "medium": "Intermediate",
    "intermediate": "Intermediate",
    "hard": "Advanced",
    "advanced": "Advanced",
    "senior": "Senior",
    "expert": "Expert",
}

TOPIC_FROM_FOLDER = {
    "01_Aggregations": "AGGREGATION",
    "02_GroupBy_Having": "GROUP BY",
    "03_Category_Product_Analytics": "BUSINESS ANALYTICS",
    "04_Correlated_Subqueries": "SUBQUERIES",
    "05_CTE": "CTE",
    "06_Left_Join": "LEFT JOIN",
    "07_Right_Join": "JOINS",
    "08_Full_Outer_Join": "JOINS",
    "09_Self_Join": "SELF JOIN",
    "10_Cross_Join": "CROSS JOIN",
    "11_Set_Operators": "UNION",
}


def extract_sql(sql_path: Path) -> str:
    text = sql_path.read_text(encoding="utf-8", errors="replace")
    # Strip block comment if present
    if text.strip().startswith("/*"):
        end = text.find("*/")
        if end != -1:
            text = text[end + 2 :]
    # Keep only non-empty, non-comment lines for the live query
    lines = []
    for line in text.splitlines():
        stripped = line.strip()
        if not stripped:
            if lines:
                lines.append("")
            continue
        if stripped.startswith("--"):
            continue
        lines.append(line)
    sql = "\n".join(lines).strip().rstrip(";") + ";"
    return sql


def parse_md(md_path: Path) -> dict:
    text = md_path.read_text(encoding="utf-8", errors="replace")
    title_m = re.search(r"^#\s+Q?\d+\.?\s*(.+)$", text, re.M)
    title = title_m.group(1).strip() if title_m else md_path.stem

    cat_m = re.search(r"\*\*Category:\*\*\s*(.+)", text)
    category = cat_m.group(1).strip() if cat_m else ""

    diff_m = re.search(r"\*\*Difficulty:\*\*\s*(.+)", text)
    difficulty_raw = diff_m.group(1).strip() if diff_m else "Medium"
    # Also check ## Difficulty section
    diff_sec = re.search(r"## Difficulty\s+\*\*(.+?)\*\*", text)
    if diff_sec:
        difficulty_raw = diff_sec.group(1).strip()

    difficulty = DIFFICULTY_MAP.get(difficulty_raw.lower(), "Intermediate")

    problem_m = re.search(
        r"## Problem Statement\s+(.*?)(?=\n## |\Z)", text, re.S
    )
    business = problem_m.group(1).strip() if problem_m else ""

    obj_m = re.search(r"## Objective\s+(.*?)(?=\n## |\Z)", text, re.S)
    objective = obj_m.group(1).strip() if obj_m else ""

    tables_m = re.search(r"## Tables Used\s+(.*?)(?=\n## |\Z)", text, re.S)
    tables = []
    if tables_m:
        for line in tables_m.group(1).splitlines():
            line = line.strip().lstrip("-").strip()
            if not line:
                continue
            # Extract bare table name
            name = re.split(r"[\s(]", line)[0].strip("`").lower()
            if name and name not in tables:
                tables.append(name)

    cols = []
    col_table = re.search(
        r"## Expected Output\s+.*?\| Column Name \|.*?\n\|[-| ]+\|\n((?:\|.*\|\n?)+)",
        text,
        re.S,
    )
    if col_table:
        for line in col_table.group(1).splitlines():
            parts = [p.strip() for p in line.strip().strip("|").split("|")]
            if parts and parts[0]:
                cols.append(parts[0])

    requirements = []
    if objective:
        requirements.append(objective)
    # Bullet-like lines under objective sometimes
    for line in (objective or "").splitlines():
        if line.strip().startswith("-") or line.strip().startswith("•"):
            requirements.append(line.strip().lstrip("-• ").strip())

    if not requirements and business:
        requirements = [business]

    return {
        "title": title,
        "category": category,
        "difficulty": difficulty,
        "business_problem": business or objective or title,
        "description": objective or business,
        "requirements": requirements[:8] if requirements else [title],
        "tables_used": tables,
        "expected_columns": cols,
    }


def main() -> None:
    questions = []

    # Include earlier foundational questions (Q1+) plus Q61+
    md_files = sorted(SOURCE.rglob("Q*.md"))
    for md in md_files:
        if "Assets" in str(md) or "files" in str(md):
            continue
        m = re.match(r"Q0*(\d+)", md.name)
        if not m:
            continue
        qnum = int(m.group(1))
        # Prefer Q1–Q50 sample + all from Q59 onward; include all for completeness
        sql_candidates = list(md.parent.glob(f"Q{qnum:02d}*.sql")) + list(
            md.parent.glob(f"Q{qnum}_*.sql")
        )
        # Also match Q83_Master... style and Q83 (1)
        if not sql_candidates:
            sql_candidates = [
                p
                for p in md.parent.glob("*.sql")
                if re.match(rf"Q0*{qnum}[^0-9]", p.name) or p.name.startswith(f"Q{qnum}")
            ]
        if not sql_candidates:
            # try exact stem
            maybe = md.with_suffix(".sql")
            if maybe.exists():
                sql_candidates = [maybe]
        if not sql_candidates:
            print(f"SKIP {md.name}: no SQL")
            continue

        sql_path = sql_candidates[0]
        meta = parse_md(md)
        folder = md.parent.name
        topic = TOPIC_FROM_FOLDER.get(folder, meta["category"].upper() or "SELECT")
        # Refine topic for set operators
        if folder == "11_Set_Operators":
            if qnum >= 86:
                topic = "CONDITIONAL AGGREGATION" if qnum >= 87 else "UNION ALL"
            else:
                topic = "UNION"

        ref_sql = extract_sql(sql_path)
        if not ref_sql or len(ref_sql) < 10:
            print(f"SKIP {md.name}: empty SQL")
            continue

        sort_required = bool(
            re.search(r"order\s+by", ref_sql, re.I)
        ) and qnum not in range(61, 71)  # self-join pairs often unordered

        questions.append(
            {
                "question_number": qnum,
                "title": meta["title"],
                "description": meta["description"],
                "business_problem": meta["business_problem"],
                "requirements": meta["requirements"],
                "difficulty": meta["difficulty"],
                "topic": topic,
                "subtopic": meta["category"] or None,
                "tables_used": meta["tables_used"]
                or (["employees"] if "Self" in folder else []),
                "reference_query": ref_sql,
                "expected_columns": meta["expected_columns"],
                "expected_result": None,
                "sort_required": sort_required,
                "starter_sql": "",
                "hints": [],
            }
        )

    # Add progression questions Q87–Q95 (conditional aggregation / country analytics)
    extras = [
        {
            "question_number": 87,
            "title": "Country Entity Counts (UNION ALL)",
            "description": "Count customers, suppliers, and employees per country in one result set.",
            "business_problem": "Leadership wants a single report of how many customers, suppliers, and employees exist in each country.",
            "requirements": [
                "Return country, entity_type, and total_records",
                "Include Customer, Supplier, and Employee entity types",
                "Use UNION ALL to combine sources before aggregating",
                "Sort by country, then entity_type",
            ],
            "difficulty": "Advanced",
            "topic": "CONDITIONAL AGGREGATION",
            "subtopic": "UNION ALL + GROUP BY",
            "tables_used": ["customers", "suppliers", "employees"],
            "reference_query": """WITH entities AS (
  SELECT country, 'Customer' AS entity_type FROM customers
  UNION ALL
  SELECT country, 'Supplier' FROM suppliers
  UNION ALL
  SELECT country, 'Employee' FROM employees
)
SELECT country, entity_type, COUNT(*) AS total_records
FROM entities
WHERE country IS NOT NULL
GROUP BY country, entity_type
ORDER BY country, entity_type;""",
            "expected_columns": ["country", "entity_type", "total_records"],
            "expected_result": None,
            "sort_required": True,
            "starter_sql": "",
            "hints": [],
        },
        {
            "question_number": 88,
            "title": "Country Totals with Entity Type Pivot",
            "description": "Show per-country counts of customers, suppliers, and employees as separate columns.",
            "business_problem": "The analytics team wants one row per country with customer_count, supplier_count, and employee_count.",
            "requirements": [
                "One row per country",
                "Columns: country, customer_count, supplier_count, employee_count",
                "Countries with any entity should appear",
                "Sort by customer_count descending",
            ],
            "difficulty": "Advanced",
            "topic": "CONDITIONAL AGGREGATION",
            "subtopic": "CASE + GROUP BY",
            "tables_used": ["customers", "suppliers", "employees"],
            "reference_query": """WITH entities AS (
  SELECT country, 'Customer' AS entity_type FROM customers
  UNION ALL
  SELECT country, 'Supplier' FROM suppliers
  UNION ALL
  SELECT country, 'Employee' FROM employees
)
SELECT
  country,
  COUNT(*) FILTER (WHERE entity_type = 'Customer') AS customer_count,
  COUNT(*) FILTER (WHERE entity_type = 'Supplier') AS supplier_count,
  COUNT(*) FILTER (WHERE entity_type = 'Employee') AS employee_count
FROM entities
WHERE country IS NOT NULL
GROUP BY country
ORDER BY customer_count DESC;""",
            "expected_columns": [
                "country",
                "customer_count",
                "supplier_count",
                "employee_count",
            ],
            "expected_result": None,
            "sort_required": True,
            "starter_sql": "",
            "hints": [],
        },
        {
            "question_number": 89,
            "title": "Countries with Both Customers and Suppliers",
            "description": "Find countries that have at least one customer and at least one supplier.",
            "business_problem": "The Sales Director wants to know which countries have both customers and suppliers.",
            "requirements": [
                "At least one customer",
                "At least one supplier",
                "Do not include employees",
                "Return country, customer_count, supplier_count",
                "Sort by customer_count descending",
            ],
            "difficulty": "Advanced",
            "topic": "CONDITIONAL AGGREGATION",
            "subtopic": "HAVING",
            "tables_used": ["customers", "suppliers"],
            "reference_query": """WITH entities AS (
  SELECT country, 'Customer' AS entity_type FROM customers
  UNION ALL
  SELECT country, 'Supplier' FROM suppliers
)
SELECT
  country,
  COUNT(*) FILTER (WHERE entity_type = 'Customer') AS customer_count,
  COUNT(*) FILTER (WHERE entity_type = 'Supplier') AS supplier_count
FROM entities
WHERE country IS NOT NULL
GROUP BY country
HAVING COUNT(*) FILTER (WHERE entity_type = 'Customer') >= 1
   AND COUNT(*) FILTER (WHERE entity_type = 'Supplier') >= 1
ORDER BY customer_count DESC;""",
            "expected_columns": ["country", "customer_count", "supplier_count"],
            "expected_result": None,
            "sort_required": True,
            "starter_sql": "",
            "hints": [],
        },
        {
            "question_number": 90,
            "title": "Countries with All Three Entity Types",
            "description": "Identify countries that have customers, suppliers, AND employees.",
            "business_problem": "Ops wants markets where the company has customers, suppliers, and employees present.",
            "requirements": [
                "At least one customer, supplier, and employee per country",
                "Return country and the three counts",
                "Sort by total entities descending",
            ],
            "difficulty": "Senior",
            "topic": "CONDITIONAL AGGREGATION",
            "subtopic": "HAVING",
            "tables_used": ["customers", "suppliers", "employees"],
            "reference_query": """WITH entities AS (
  SELECT country, 'Customer' AS entity_type FROM customers
  UNION ALL
  SELECT country, 'Supplier' FROM suppliers
  UNION ALL
  SELECT country, 'Employee' FROM employees
)
SELECT
  country,
  COUNT(*) FILTER (WHERE entity_type = 'Customer') AS customer_count,
  COUNT(*) FILTER (WHERE entity_type = 'Supplier') AS supplier_count,
  COUNT(*) FILTER (WHERE entity_type = 'Employee') AS employee_count,
  COUNT(*) AS total_entities
FROM entities
WHERE country IS NOT NULL
GROUP BY country
HAVING COUNT(*) FILTER (WHERE entity_type = 'Customer') >= 1
   AND COUNT(*) FILTER (WHERE entity_type = 'Supplier') >= 1
   AND COUNT(*) FILTER (WHERE entity_type = 'Employee') >= 1
ORDER BY total_entities DESC;""",
            "expected_columns": [
                "country",
                "customer_count",
                "supplier_count",
                "employee_count",
                "total_entities",
            ],
            "expected_result": None,
            "sort_required": True,
            "starter_sql": "",
            "hints": [],
        },
        {
            "question_number": 91,
            "title": "Customer vs Supplier Presence by Country",
            "description": "Classify countries by whether they have customers only, suppliers only, or both.",
            "business_problem": "The strategy team wants a presence classification for each country.",
            "requirements": [
                "Classify each country as Customers Only, Suppliers Only, or Both",
                "Exclude countries with neither",
                "Return country, customer_count, supplier_count, presence",
                "Sort by presence, then country",
            ],
            "difficulty": "Senior",
            "topic": "CASE",
            "subtopic": "Conditional Aggregation",
            "tables_used": ["customers", "suppliers"],
            "reference_query": """WITH entities AS (
  SELECT country, 'Customer' AS entity_type FROM customers
  UNION ALL
  SELECT country, 'Supplier' FROM suppliers
),
agg AS (
  SELECT
    country,
    COUNT(*) FILTER (WHERE entity_type = 'Customer') AS customer_count,
    COUNT(*) FILTER (WHERE entity_type = 'Supplier') AS supplier_count
  FROM entities
  WHERE country IS NOT NULL
  GROUP BY country
)
SELECT
  country,
  customer_count,
  supplier_count,
  CASE
    WHEN customer_count > 0 AND supplier_count > 0 THEN 'Both'
    WHEN customer_count > 0 THEN 'Customers Only'
    ELSE 'Suppliers Only'
  END AS presence
FROM agg
WHERE customer_count > 0 OR supplier_count > 0
ORDER BY presence, country;""",
            "expected_columns": [
                "country",
                "customer_count",
                "supplier_count",
                "presence",
            ],
            "expected_result": None,
            "sort_required": True,
            "starter_sql": "",
            "hints": [],
        },
    ]
    questions.extend(extras)

    questions.sort(key=lambda q: q["question_number"])
    # Deduplicate by question_number
    seen = set()
    unique = []
    for q in questions:
        if q["question_number"] in seen:
            continue
        seen.add(q["question_number"])
        unique.append(q)

    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(
        json.dumps({"questions": unique}, indent=2, ensure_ascii=False) + "\n",
        encoding="utf-8",
    )
    print(f"Wrote {len(unique)} questions to {OUT}")


if __name__ == "__main__":
    main()
