"""Build static data for the public website.

Parses the sibling northwind-sql-practice repo (Q*.md + Q*.sql) with the
backend's repo parser and writes JSON + the Northwind SQL bundle into
frontend/public/data/, so the public build needs no server.

Usage (from sql-practice-platform/):
    backend/.venv/bin/python scripts/build_public_data.py [--repo ../northwind-sql-practice]
"""

from __future__ import annotations

import argparse
import json
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "backend"))

from app.services.repo_parser import extract_sql, find_sql_for_md, parse_markdown  # noqa: E402

OUT = ROOT / "frontend" / "public" / "data"

FOLDERS = {
    "01_Aggregations": ("aggregations", "Aggregations"),
    "02_GroupBy_Having": ("group-by-having", "GROUP BY & HAVING"),
    "03_Category_Product_Analytics": ("category-product-analytics", "Category & Product Analytics"),
    "04_Correlated_Subqueries": ("correlated-subqueries", "Correlated Subqueries"),
    "05_CTE": ("cte", "Common Table Expressions"),
    "06_Left_Join": ("left-join", "LEFT JOIN"),
    "07_Right_Join": ("right-join", "RIGHT JOIN"),
    "08_Full_Outer_Join": ("full-outer-join", "FULL OUTER JOIN"),
    "09_Self_Join": ("self-join", "SELF JOIN"),
    "10_Cross_Join": ("cross-join", "CROSS JOIN"),
    "11_Set_Operators": ("set-operators", "Set Operators"),
}


def clip(text: str, limit: int) -> str:
    """Collapse whitespace and cut at a word boundary."""
    text = re.sub(r"\s+", " ", text or "").strip()
    if len(text) <= limit:
        return text
    cut = text[: limit - 1]
    return cut[: cut.rfind(" ")] + "…"


def slugify(text: str) -> str:
    return re.sub(r"[^a-z0-9]+", "-", text.lower()).strip("-")


def raw_difficulty(md_text: str) -> str:
    m = re.search(r"\*\*Difficulty:\*\*\s*([A-Za-z]+)", md_text)
    return m.group(1).capitalize() if m else "Medium"


def sql_block(section: str | None) -> str:
    if not section:
        return ""
    m = re.search(r"```sql\s*(.*?)```", section, re.S | re.I)
    return m.group(1).strip() if m else ""


def outer_order_by(sql: str) -> tuple[bool, list[dict] | None]:
    """Find the top-level ORDER BY of a query.

    Returns (has_order_by, keys). keys lists {"column", "desc"} when every sort
    expression is a plain column/alias or ordinal, so the grader can accept any
    order among tied rows; None means "compare row order strictly".
    """
    clean = re.sub(r"--[^\n]*", " ", sql)
    clean = re.sub(r"/\*.*?\*/", " ", clean, flags=re.S)
    clean = re.sub(r"'(?:[^']|'')*'", "''", clean)
    depth, start = 0, None
    lower = clean.lower()
    i = 0
    while i < len(clean):
        ch = clean[i]
        if ch == "(":
            depth += 1
        elif ch == ")":
            depth -= 1
        elif depth == 0 and re.match(r"order\s+by\b", lower[i:]) and (i == 0 or not lower[i - 1].isalnum()):
            start = i + len(re.match(r"order\s+by", lower[i:]).group(0))
        i += 1
    if start is None:
        return False, None
    tail = re.split(r"\b(?:limit|offset|fetch)\b|;", clean[start:], maxsplit=1, flags=re.I)[0]
    items, depth, cur = [], 0, ""
    for ch in tail:
        if ch == "(":
            depth += 1
        elif ch == ")":
            depth -= 1
        if ch == "," and depth == 0:
            items.append(cur)
            cur = ""
        else:
            cur += ch
    items.append(cur)
    keys = []
    for item in items:
        m = re.fullmatch(
            r'\s*(?:\w+\.)?("?)(\w+)\1\s*(asc|desc)?\s*(?:nulls\s+(?:first|last))?\s*', item, re.I
        )
        if not m:
            return True, None
        keys.append({"column": m.group(2), "desc": (m.group(3) or "").lower() == "desc"})
    return True, keys


def section(text: str, heading: str) -> str | None:
    m = re.search(rf"##\s+{re.escape(heading)}\s+(.*?)(?=\n##\s+|\Z)", text, re.S | re.I)
    return m.group(1).strip() if m else None


def build_question(md: Path) -> dict | None:
    if md.parent.name not in FOLDERS:
        return None
    md_text = md.read_text(encoding="utf-8")
    meta = parse_markdown(md_text, folder=md.parent.name, md_path=str(md))
    sql_path = find_sql_for_md(md)
    solution = extract_sql(sql_path.read_text(encoding="utf-8")) if sql_path else ""
    number = meta["question_number"]
    topic_slug, topic_label = FOLDERS[md.parent.name]
    my_solution = sql_block(section(md_text, "3. My Solution (as submitted)")) or solution
    has_order, order_keys = outer_order_by(solution)
    return {
        "number": number,
        "slug": f"q{number:02d}-{slugify(meta['title'])}",
        "title": meta["title"],
        "topic": topic_slug,
        "topicLabel": topic_label,
        "category": meta["category"],
        "difficulty": raw_difficulty(md_text),
        "concepts": meta["concepts_used"],
        "outcome": meta["outcome"],
        "hadMistakes": meta["outcome"].startswith("⚠"),
        "watchOutFor": meta["watch_out_for"],
        "problem": meta["business_problem"],
        "objective": meta["objective"],
        "tables": meta["tables_used"],
        "expectedOutput": meta["expected_output"],
        "approach": meta["approach"],
        "mySolution": my_solution,
        "myMistakes": meta["my_mistakes"],
        # The runnable .sql query is the graded answer, so it is also the one shown.
        "solution": solution,
        "referenceQuery": solution,
        "sortRequired": has_order,
        "orderBy": order_keys,
        "why": meta["why_this_approach"],
        "pitfalls": meta["common_mistakes"],
        "followups": meta["interview_followups"],
        "takeaway": meta["key_takeaway"],
        "related": [n for n in meta["related_question_numbers"] if n != number],
    }


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--repo", default=str(ROOT.parent / "northwind-sql-practice"))
    args = ap.parse_args()
    repo = Path(args.repo).resolve()
    if not repo.exists():
        sys.exit(f"Question repo not found: {repo}")

    questions = [q for q in (build_question(p) for p in sorted(repo.rglob("Q*.md"))) if q]
    questions.sort(key=lambda q: q["number"])
    known = {q["number"] for q in questions}
    for q in questions:
        q["related"] = [n for n in q["related"] if n in known][:6]

    topics = []
    for folder, (slug, label) in FOLDERS.items():
        nums = [q["number"] for q in questions if q["topic"] == slug]
        if nums:
            topics.append({"slug": slug, "label": label, "folder": folder, "questions": nums})

    summary_keys = ("number", "slug", "title", "topic", "topicLabel", "difficulty", "concepts", "hadMistakes", "watchOutFor", "takeaway")
    index = [
        {
            **{k: q[k] for k in summary_keys},
            "problemShort": clip(q["objective"] or q["problem"], 220),
            "answerShort": clip(q["approach"], 320),
            "mistakeShort": clip(" ".join(q["myMistakes"]), 220),
        }
        for q in questions
    ]

    OUT.mkdir(parents=True, exist_ok=True)
    (OUT / "q").mkdir(exist_ok=True)
    for old in (OUT / "q").glob("*.json"):
        old.unlink()
    for q in questions:
        (OUT / "q" / f"{q['slug']}.json").write_text(json.dumps(q, ensure_ascii=False), encoding="utf-8")
    (OUT / "index.json").write_text(json.dumps(index, ensure_ascii=False), encoding="utf-8")
    (OUT / "topics.json").write_text(json.dumps(topics, ensure_ascii=False), encoding="utf-8")
    (OUT / "questions.json").unlink(missing_ok=True)
    northwind = (ROOT / "database" / "schema.sql").read_text() + "\n" + (ROOT / "database" / "seed.sql").read_text()
    (OUT / "northwind.sql").write_text(northwind, encoding="utf-8")
    print(f"Wrote {len(questions)} questions, {len(topics)} topics to {OUT.relative_to(ROOT)}")


if __name__ == "__main__":
    main()
