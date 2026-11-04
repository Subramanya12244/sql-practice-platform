"""Parse northwind-sql-practice style Markdown + SQL question pairs.

Preserves the existing folder structure and Q-numbering.
Does not invent missing sections — empty / None when absent.
"""

from __future__ import annotations

import hashlib
import re
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

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


def extract_sql(text: str) -> str:
    """Extract executable SQL from a .sql file (strip comments)."""
    if text.strip().startswith("/*"):
        end = text.find("*/")
        if end != -1:
            text = text[end + 2 :]
    lines: List[str] = []
    for line in text.splitlines():
        stripped = line.strip()
        if not stripped:
            if lines:
                lines.append("")
            continue
        if stripped.startswith("--"):
            continue
        lines.append(line)
    sql = "\n".join(lines).strip().rstrip(";")
    return (sql + ";") if sql else ""


def _section(text: str, heading: str) -> Optional[str]:
    pattern = rf"##\s+{re.escape(heading)}\s+(.*?)(?=\n##\s+|\Z)"
    m = re.search(pattern, text, re.S | re.I)
    return m.group(1).strip() if m else None


def _bullets(block: Optional[str]) -> List[str]:
    if not block:
        return []
    items: List[str] = []
    for line in block.splitlines():
        stripped = line.strip()
        if stripped.startswith(("-", "*", "•")):
            item = stripped.lstrip("-*• ").strip()
            item = item.replace("**", "")
            items.append(item)
        elif stripped.startswith("|") or not stripped:
            continue
        elif items and not stripped.startswith("#"):
            items[-1] = items[-1] + " " + stripped.replace("**", "")
    return [i for i in items if i]


def _followups(block: Optional[str]) -> List[Dict[str, str]]:
    if not block:
        return []
    followups: List[Dict[str, str]] = []
    # Split on **N. question** or bare numbered questions
    parts = re.split(r"\*\*\d+\.\s*(.+?)\*\*", block)
    # parts: [preamble, q1, a1, q2, a2, ...]
    if len(parts) >= 3:
        for i in range(1, len(parts) - 1, 2):
            q = parts[i].strip()
            a = parts[i + 1].strip() if i + 1 < len(parts) else ""
            followups.append({"question": q, "answer": a[:1500]})
    else:
        # Fallback: each ### heading or numbered line
        for m in re.finditer(
            r"(?:^|\n)\s*(?:\*\*)?(\d+\.\s*.+?)(?:\*\*)?\s*\n+(.*?)(?=\n\s*(?:\*\*)?\d+\.|\Z)",
            block,
            re.S,
        ):
            followups.append(
                {"question": m.group(1).strip(), "answer": m.group(2).strip()[:1500]}
            )
    return followups


def _related_q_numbers(text: str) -> List[int]:
    nums = set()
    for m in re.finditer(r"\bQ(\d{1,3})\b", text):
        n = int(m.group(1))
        if 1 <= n <= 999:
            nums.add(n)
    return sorted(nums)


def _card_field(text: str, name: str) -> str:
    """Read one `**Name:** value` field from the Revision Card blockquote."""
    m = re.search(rf"\*\*{re.escape(name)}:\*\*\s*(.+?)(?=\s+\|\s+\*\*|$)", text, re.M)
    return m.group(1).strip() if m else ""


def _tables_from_line(line: str) -> List[str]:
    tables: List[str] = []
    for a, b in re.findall(r"`([A-Za-z_][\w]*)`|([A-Za-z_][A-Za-z0-9_]*)", line):
        name = (a or b).lower()
        if name in {"and", "or", "the", "table", "tables", "used", "from"}:
            continue
        if name and name not in tables:
            tables.append(name)
    return tables


def _parse_revision_format(text: str) -> Dict[str, Any]:
    """Parse the STYLE.md revision layout (Revision Card + numbered §1–§9).

    Returns only the fields this layout defines; parse_markdown merges them
    over its legacy-format results.
    """
    problem_block = _section(text, "1. Problem") or ""
    # §1 holds the statement, then **Objective:** / **Tables:** / **Expected output:** lines.
    statement = re.split(r"\n\*\*(?:Objective|Tables|Expected output)", problem_block, maxsplit=1)[0].strip()
    obj_m = re.search(r"\*\*Objective:\*\*\s*(.+)", problem_block)
    tables_m = re.search(r"\*\*Tables(?: Used)?:\*\*\s*(.+)", problem_block)
    exp_m = re.search(r"\*\*Expected output:\*\*\s*(.*)", problem_block, re.S | re.I)

    concepts_raw = _card_field(text, "Concepts")
    concepts = [c.strip() for c in re.split(r"\s+·\s+", concepts_raw) if c.strip()]

    mistakes_mine = _bullets(_section(text, "4. Mistakes I Made"))
    mistakes_mine = [m for m in mistakes_mine if not m.lower().startswith("none")]

    takeaway = (_section(text, "9. Key Takeaway") or "").split("\n---")[0].strip()

    return {
        "business_problem": statement,
        "objective": obj_m.group(1).strip() if obj_m else "",
        "tables_used": _tables_from_line(tables_m.group(1)) if tables_m else [],
        "expected_output": (exp_m.group(1).strip() if exp_m else "")[:4000],
        "concepts_used": concepts,
        "outcome": _card_field(text, "Outcome"),
        "watch_out_for": _card_field(text, "Watch out for"),
        "approach": _section(text, "2. My Approach") or "",
        "my_mistakes": mistakes_mine,
        "why_this_approach": (_section(text, "6. Why This Works") or "")[:4000],
        "common_mistakes": _bullets(_section(text, "7. Common Pitfalls (generic)")),
        "interview_followups": _followups(_section(text, "8. Interview Follow-ups")),
        "learning_outcomes": [takeaway] if takeaway else [],
        "key_takeaway": takeaway,
    }


def parse_markdown(text: str, *, folder: str = "", md_path: str = "") -> Dict[str, Any]:
    """Parse a Q*.md file into structured question fields."""
    title_m = re.search(r"^#\s+Q?\d+\.?\s*(?:·\s*)?(.+)$", text, re.M)
    title = title_m.group(1).strip() if title_m else Path(md_path).stem if md_path else "Untitled"

    category = _card_field(text, "Category")

    diff_m = re.search(r"\*\*Difficulty:\*\*\s*(.+)", text)
    difficulty_raw = diff_m.group(1).strip() if diff_m else ""
    diff_sec = re.search(r"##\s+Difficulty\s+\*\*(.+?)\*\*", text)
    if diff_sec:
        difficulty_raw = diff_sec.group(1).strip()
    difficulty = (
        DIFFICULTY_MAP.get(difficulty_raw.lower(), None) if difficulty_raw else None
    )
    # Fall back to Intermediate only as a map default for known values;
    # if completely missing, leave as Intermediate for DB NOT NULL constraint
    # but mark suggested separately in callers if needed.
    if difficulty is None:
        difficulty = "Intermediate"

    problem = _section(text, "Problem Statement") or ""
    objective = _section(text, "Objective") or ""

    tables_block = _section(text, "Tables Used")
    tables: List[str] = []
    if tables_block:
        for line in tables_block.splitlines():
            line = line.strip().lstrip("-*•").strip()
            if not line or line.startswith("|") or line.startswith("_"):
                continue
            # One line may list several tables: "`employees` `suppliers`" or
            # "employees, suppliers, customers" or even space-separated names.
            parts = re.findall(r"`([A-Za-z_][\w]*)`|([A-Za-z_][A-Za-z0-9_]*)", line)
            for a, b in parts:
                name = (a or b).lower()
                if name in {"and", "or", "the", "table", "tables", "used", "from"}:
                    continue
                if name and name not in tables:
                    tables.append(name)

    expected_output = _section(text, "Expected Output") or ""
    cols: List[str] = []
    col_table = re.search(
        r"\| Column(?: Name)? \|.*?\n\|[-| ]+\|\n((?:\|.*\|\n?)+)",
        expected_output,
        re.S,
    )
    if col_table:
        for line in col_table.group(1).splitlines():
            parts = [p.strip() for p in line.strip().strip("|").split("|")]
            if parts and parts[0] and not parts[0].startswith("-"):
                # Skip sample data rows that look like values
                if re.match(r"^[A-Za-z_][A-Za-z0-9_]*$", parts[0].replace(" ", "_")) or " " not in parts[0]:
                    candidate = parts[0]
                    if candidate.lower() not in ("customer", "supplier", "employee") or len(cols) < 3:
                        # Prefer header-looking names
                        if re.match(r"^[A-Za-z_][\w\s]*$", candidate) and not re.match(r"^\d+$", candidate):
                            if candidate not in cols and len(candidate) < 60:
                                cols.append(candidate)

    # Clean expected columns: keep header-like names only
    cleaned_cols = []
    for c in cols:
        if c.lower() in ("column name", "description"):
            continue
        # Sample rows often have Entity_Type values like Customer — keep first few header names
        if re.match(r"^[A-Za-z_][A-Za-z0-9_]*$", c.replace(" ", "_")):
            cleaned_cols.append(c.replace(" ", "_") if " " in c else c)
    # Prefer snake/Pascal header names from first table only
    expected_columns = cleaned_cols[:8]

    concepts_block = _section(text, "Concepts Used")
    concepts_used = _bullets(concepts_block)
    if not concepts_used and concepts_block:
        concepts_used = [
            ln.strip().lstrip("-• ").strip()
            for ln in concepts_block.splitlines()
            if ln.strip() and not ln.strip().startswith("|")
        ]

    why = (
        _section(text, "Why This Approach")
        or _section(text, "The Two Approaches")
        or ""
    )
    # Prefer the ✅ Correct Approach explanation if present
    correct_m = re.search(
        r"###\s*✅\s*Correct Approach.*?\n(.*?)(?=\n##\s+|\Z)",
        text,
        re.S | re.I,
    )
    if correct_m and not why:
        why = correct_m.group(0).strip()[:4000]

    mistakes_block = _section(text, "Common Mistakes")
    common_mistakes = _bullets(mistakes_block)
    if not common_mistakes and mistakes_block:
        common_mistakes = [mistakes_block[:800]]

    followups_block = _section(text, "Interview Follow-up Questions")
    interview_followups = _followups(followups_block)

    outcomes_block = _section(text, "Learning Outcomes")
    learning_outcomes = _bullets(outcomes_block)
    if not learning_outcomes and outcomes_block:
        learning_outcomes = [
            ln.strip().lstrip("-• ").strip()
            for ln in outcomes_block.splitlines()
            if ln.strip()
        ]

    requirements: List[str] = []
    if objective:
        requirements.append(objective)
    for line in (objective or "").splitlines():
        if line.strip().startswith(("-", "•")):
            requirements.append(line.strip().lstrip("-• ").strip())
    if not requirements and problem:
        requirements = [problem[:400]]

    topic = TOPIC_FROM_FOLDER.get(folder, (category.upper() if category else "SELECT"))
    related = _related_q_numbers(text)

    qnum_m = re.search(r"^#\s+Q0*(\d+)", text, re.M)
    question_number = int(qnum_m.group(1)) if qnum_m else None

    # Prefer the ✅ Correct Approach SQL block as the reference solution
    reference_query = ""
    correct_sql_m = re.search(
        r"###\s*✅?\s*Correct Approach.*?(?:```sql\s*(.*?)```)",
        text,
        re.S | re.I,
    )
    if correct_sql_m:
        reference_query = correct_sql_m.group(1).strip()
    else:
        # Fallback: last ```sql``` block in Approaches / Correct sections
        blocks = re.findall(r"```sql\s*(.*?)```", text, re.S | re.I)
        if blocks:
            reference_query = blocks[-1].strip()

    parsed = {
        "title": title,
        "category": category,
        "difficulty": difficulty,
        "business_problem": problem or objective or title,
        "description": objective or problem or "",
        "objective": objective,
        "requirements": requirements[:12] if requirements else [title],
        "tables_used": tables,
        "expected_columns": expected_columns,
        "expected_output": expected_output[:4000],
        "concepts_used": concepts_used,
        "why_this_approach": why[:4000],
        "common_mistakes": common_mistakes,
        "interview_followups": interview_followups,
        "learning_outcomes": learning_outcomes,
        "topic": topic,
        "subtopic": category or None,
        "folder_category": folder or None,
        "related_question_numbers": related,
        "question_number": question_number,
        "reference_query": reference_query,
    }

    if "Revision Card" in text:
        rev = _parse_revision_format(text)
        # Keep legacy values only where the revision layout left a field empty.
        parsed.update({k: v for k, v in rev.items() if v or k not in parsed})
        statement = rev["business_problem"] or title
        parsed["business_problem"] = statement
        parsed["description"] = rev["objective"] or statement
        parsed["requirements"] = [rev["objective"]] if rev["objective"] else [statement[:400]]

    return parsed


def find_sql_for_md(md_path: Path) -> Optional[Path]:
    m = re.match(r"Q0*(\d+)", md_path.name)
    if not m:
        return None
    qnum = int(m.group(1))
    parent = md_path.parent
    candidates = list(parent.glob(f"Q{qnum:02d}*.sql")) + list(
        parent.glob(f"Q{qnum}_*.sql")
    )
    if not candidates:
        candidates = [
            p
            for p in parent.glob("*.sql")
            if re.match(rf"Q0*{qnum}[^0-9]", p.name) or p.name.startswith(f"Q{qnum}")
        ]
    if not candidates:
        maybe = md_path.with_suffix(".sql")
        if maybe.exists():
            return maybe
        return None
    return candidates[0]


def content_hash(md_text: str, sql_text: str) -> str:
    h = hashlib.sha256()
    h.update(md_text.encode("utf-8", errors="replace"))
    h.update(b"\0")
    h.update(sql_text.encode("utf-8", errors="replace"))
    return h.hexdigest()


def github_status_for(has_md: bool, has_sql: bool) -> str:
    if has_md and has_sql:
        return "documented"
    if has_md or has_sql:
        return "incomplete"
    return "incomplete"


def scan_local_repo(root: Path) -> List[Dict[str, Any]]:
    """Scan a local clone of northwind-sql-practice for Q*.md + matching .sql.

    Presence of docs does NOT mean first-attempt correct — only github_status.
    """
    questions: List[Dict[str, Any]] = []
    if not root.exists():
        return questions

    by_number: Dict[int, Dict[str, Any]] = {}

    for md in sorted(root.rglob("Q*.md")):
        if "Assets" in md.parts or "files" in md.parts:
            continue
        m = re.match(r"Q0*(\d+)", md.name)
        if not m:
            continue
        qnum = int(m.group(1))
        sql_path = find_sql_for_md(md)
        md_text = md.read_text(encoding="utf-8", errors="replace")
        meta = parse_markdown(md_text, folder=md.parent.name, md_path=str(md))
        sql_text = ""
        has_sql = bool(sql_path and sql_path.exists())
        if has_sql:
            raw_sql = sql_path.read_text(encoding="utf-8", errors="replace")
            sql_text = raw_sql
            ref_sql = extract_sql(raw_sql)
        else:
            ref_sql = ""

        try:
            rel_md = str(md.relative_to(root))
            rel_sql = str(sql_path.relative_to(root)) if sql_path and has_sql else None
        except ValueError:
            rel_md = str(md)
            rel_sql = str(sql_path) if sql_path else None

        sort_required = bool(re.search(r"order\s+by", ref_sql, re.I))
        folder = md.parent.name
        topic = meta["topic"]
        if folder == "11_Set_Operators":
            if qnum >= 87:
                topic = "CONDITIONAL AGGREGATION"
            elif qnum >= 86:
                topic = "UNION ALL"
            else:
                topic = "UNION"

        has_md = True
        by_number[qnum] = {
            "question_number": qnum,
            "title": meta["title"],
            "description": meta["description"],
            "business_problem": meta["business_problem"],
            "objective": meta["objective"],
            "requirements": meta["requirements"],
            "difficulty": meta["difficulty"],
            "topic": topic,
            "subtopic": meta["subtopic"],
            "tables_used": meta["tables_used"],
            "reference_query": ref_sql,
            "expected_columns": meta["expected_columns"],
            "expected_output": meta["expected_output"],
            "concepts_used": meta["concepts_used"],
            "why_this_approach": meta["why_this_approach"],
            "common_mistakes": meta["common_mistakes"],
            "interview_followups": meta["interview_followups"],
            "learning_outcomes": meta["learning_outcomes"],
            "expected_result": None,
            "sort_required": sort_required,
            "starter_sql": "",
            "hints": [],
            "github_md_path": rel_md,
            "github_sql_path": rel_sql,
            "folder_category": folder,
            "related_question_numbers": [
                n for n in meta["related_question_numbers"] if n != qnum
            ],
            "has_md": has_md,
            "has_sql": has_sql,
            "github_status": github_status_for(has_md, has_sql),
            "content_hash": content_hash(md_text, sql_text),
        }

    # Orphan .sql files without matching .md
    for sql in sorted(root.rglob("Q*.sql")):
        if "Assets" in sql.parts or "files" in sql.parts:
            continue
        m = re.match(r"Q0*(\d+)", sql.name)
        if not m:
            continue
        qnum = int(m.group(1))
        if qnum in by_number:
            continue
        raw_sql = sql.read_text(encoding="utf-8", errors="replace")
        try:
            rel_sql = str(sql.relative_to(root))
        except ValueError:
            rel_sql = str(sql)
        by_number[qnum] = {
            "question_number": qnum,
            "title": f"Question {qnum}",
            "description": "",
            "business_problem": "",
            "objective": "",
            "requirements": [],
            "difficulty": "Intermediate",
            "topic": TOPIC_FROM_FOLDER.get(sql.parent.name, "SELECT"),
            "subtopic": None,
            "tables_used": [],
            "reference_query": extract_sql(raw_sql),
            "expected_columns": [],
            "expected_output": "",
            "concepts_used": [],
            "why_this_approach": "",
            "common_mistakes": [],
            "interview_followups": [],
            "learning_outcomes": [],
            "expected_result": None,
            "sort_required": False,
            "starter_sql": "",
            "hints": [],
            "github_md_path": None,
            "github_sql_path": rel_sql,
            "folder_category": sql.parent.name,
            "related_question_numbers": [],
            "has_md": False,
            "has_sql": True,
            "github_status": "incomplete",
            "content_hash": content_hash("", raw_sql),
        }

    unique = sorted(by_number.values(), key=lambda x: x["question_number"])
    return unique


def next_question_number(existing_numbers: List[int]) -> int:
    return (max(existing_numbers) + 1) if existing_numbers else 1


def folder_for_topic(topic: str) -> str:
    topic_u = (topic or "").upper()
    for folder, mapped in TOPIC_FROM_FOLDER.items():
        if mapped == topic_u or mapped in topic_u or topic_u in mapped:
            return folder
    if "AGGREG" in topic_u or "CASE" in topic_u:
        return "11_Set_Operators"
    if "UNION" in topic_u:
        return "11_Set_Operators"
    if "SELF" in topic_u:
        return "09_Self_Join"
    if "CROSS" in topic_u:
        return "10_Cross_Join"
    if "CTE" in topic_u:
        return "05_CTE"
    if "SUBQUERY" in topic_u:
        return "04_Correlated_Subqueries"
    return "11_Set_Operators"


def slugify_title(title: str) -> str:
    slug = re.sub(r"[^A-Za-z0-9]+", "_", title.strip()).strip("_")
    return slug[:80] or "Question"


def generate_markdown_doc(question: Dict[str, Any]) -> str:
    """Generate professional GitHub Markdown for a question (no attempt history)."""
    qnum = int(question["question_number"])
    title = question.get("title") or f"Question {qnum}"
    difficulty = question.get("difficulty") or "Intermediate"
    topic = question.get("topic") or "SELECT"
    category = question.get("subtopic") or topic
    problem = question.get("business_problem") or ""
    objective = question.get("objective") or question.get("description") or ""
    tables = question.get("tables_used") or []
    concepts = question.get("concepts_used") or []
    mistakes = question.get("common_mistakes") or []
    followups = question.get("interview_followups") or []
    outcomes = question.get("learning_outcomes") or []
    why = question.get("why_this_approach") or ""
    expected_output = question.get("expected_output") or ""
    related = question.get("related_question_numbers") or []
    wrong_attempts = question.get("wrong_approaches") or []
    correct_sql = question.get("reference_query") or question.get("correct_sql") or ""

    lines: List[str] = []
    lines.append(f"# Q{qnum}. {title}")
    lines.append("")
    lines.append(f"**Category:** {category}")
    lines.append(f"**Difficulty:** {difficulty}")
    lines.append("")
    lines.append("---")
    lines.append("")
    lines.append("## Problem Statement")
    lines.append("")
    lines.append(problem or "_Not provided._")
    lines.append("")
    lines.append("## Objective")
    lines.append("")
    lines.append(objective or "_Not provided._")
    lines.append("")
    lines.append("## Tables Used")
    lines.append("")
    if tables:
        for t in tables:
            lines.append(f"- `{t}`")
    else:
        lines.append("_Not specified._")
    lines.append("")
    lines.append("## Expected Output")
    lines.append("")
    if expected_output:
        lines.append(expected_output)
    else:
        cols = question.get("expected_columns") or []
        if cols:
            lines.append("| Column Name | Description |")
            lines.append("|-------------|-------------|")
            for c in cols:
                lines.append(f"| {c} | |")
        else:
            lines.append("_Not provided — do not invent sample rows._")
    lines.append("")
    lines.append("## Concepts Used")
    lines.append("")
    if concepts:
        for c in concepts:
            lines.append(f"- {c}")
    else:
        lines.append("_Not specified._")
    lines.append("")

    if wrong_attempts or correct_sql:
        lines.append("## Approaches")
        lines.append("")
        for i, wa in enumerate(wrong_attempts, 1):
            sql = wa.get("sql", "")
            note = wa.get("note", "")
            lines.append(f"### ❌ Wrong Approach {i}")
            lines.append("")
            lines.append("```sql")
            lines.append(sql.rstrip())
            lines.append("```")
            lines.append("")
            if note:
                lines.append(note)
                lines.append("")
        if correct_sql:
            lines.append("### ✅ Correct Approach")
            lines.append("")
            lines.append("```sql")
            lines.append(correct_sql.rstrip())
            lines.append("```")
            lines.append("")

    if why:
        lines.append("## Why This Approach")
        lines.append("")
        lines.append(why)
        lines.append("")

    lines.append("## Common Mistakes")
    lines.append("")
    if mistakes:
        for m in mistakes:
            lines.append(f"- {m}")
    else:
        lines.append("_None documented yet._")
    lines.append("")
    lines.append("## Difficulty")
    lines.append("")
    lines.append(f"**{difficulty}**")
    lines.append("")
    lines.append("## Interview Follow-up Questions")
    lines.append("")
    if followups:
        for i, fu in enumerate(followups, 1):
            if isinstance(fu, dict):
                lines.append(f"**{i}. {fu.get('question', '')}**")
                lines.append("")
                if fu.get("answer"):
                    lines.append(fu["answer"])
                    lines.append("")
            else:
                lines.append(f"- {fu}")
    else:
        lines.append("_None yet._")
    lines.append("")
    lines.append("## Learning Outcomes")
    lines.append("")
    if outcomes:
        for o in outcomes:
            lines.append(f"- {o}")
    else:
        lines.append("_None yet._")
    lines.append("")

    if related:
        lines.append("## Related Questions")
        lines.append("")
        for n in related:
            lines.append(f"- Q{n}")
        lines.append("")

    return "\n".join(lines).rstrip() + "\n"


def generate_sql_file(question: Dict[str, Any]) -> str:
    """Generate linked .sql file. Preserves original SQL exactly when present."""
    qnum = int(question["question_number"])
    title = question.get("title") or f"Question {qnum}"
    correct = question.get("reference_query") or question.get("correct_sql") or ""
    wrong = question.get("wrong_approaches") or []

    parts: List[str] = []
    parts.append(f"/* Q{qnum}. {title} */")
    parts.append("")
    if wrong:
        for i, wa in enumerate(wrong, 1):
            parts.append(f"-- Wrong Approach {i}")
            note = wa.get("note")
            if note:
                for line in note.splitlines():
                    parts.append(f"-- {line}")
            parts.append("/*")
            parts.append(wa.get("sql", "").rstrip())
            parts.append("*/")
            parts.append("")
    if correct:
        parts.append("-- Correct Approach")
        parts.append(correct.rstrip().rstrip(";") + ";")
        parts.append("")
    else:
        parts.append("-- No reference SQL available yet.")
        parts.append("")
    return "\n".join(parts)
