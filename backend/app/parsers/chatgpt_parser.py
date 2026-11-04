"""ChatGPT conversations.json parser.

Layered pipeline:
  1. ConversationLoader      — parse raw JSON, build message trees
  2. ConversationScorer      — rank conversations by SQL-practice relevance
  3. MessageTreeWalker       — flatten conversation into ordered messages
  4. QuestionBoundaryDetector — detect Q59, Q60, … boundaries
  5. SqlBlockDetector        — extract SQL blocks from user messages
  6. AttemptAssociator       — link each SQL block to a question
  7. FeedbackExtractor       — extract assistant feedback per attempt
  8. MistakeExtractor        — identify and categorise mistakes
  9. ScoreExtractor          — parse numeric scores
  10. ConceptExtractor        — identify SQL concepts discussed

No information is invented.  Where a field cannot be reliably determined,
it is set to None and optionally a suggestion is attached.
"""

from __future__ import annotations

import re
from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional, Tuple


# ---------------------------------------------------------------------------
# Domain types
# ---------------------------------------------------------------------------


@dataclass
class ParsedMessage:
    msg_id: str
    role: str  # user | assistant | system
    text: str
    create_time: Optional[datetime]
    node_id: str


@dataclass
class ParsedScore:
    score: float
    max_score: float
    score_text: str
    source_message_id: str


@dataclass
class ParsedFeedback:
    feedback_type: str
    feedback_text: str
    source_message_id: str


@dataclass
class ParsedMistake:
    category: str
    description: str
    correction: Optional[str]
    source_message_id: str


@dataclass
class ParsedConcept:
    name: str
    description: Optional[str]
    source_message_id: str


@dataclass
class ParsedAttempt:
    sql: str
    attempt_number: int
    source_message_id: str
    approach_notes: Optional[str]
    # Filled in post-parse by associating with feedback
    is_correct: Optional[bool] = None
    score: Optional[ParsedScore] = None
    feedbacks: List[ParsedFeedback] = field(default_factory=list)
    mistakes: List[ParsedMistake] = field(default_factory=list)


@dataclass
class ParsedQuestion:
    question_number: int
    question_number_source: str  # explicit | inferred
    title: Optional[str]
    business_problem: Optional[str]
    requirements: List[str]
    tables_used: List[str]
    difficulty: Optional[str]  # None if not explicitly stated
    topic: Optional[str]  # None if not explicitly stated
    subtopic: Optional[str]
    suggested_difficulty: Optional[str]  # computed suggestion, labelled as such
    suggested_topic: Optional[str]
    source_message_ids: List[str]
    original_text: str  # raw assistant intro text
    attempts: List[ParsedAttempt]
    feedback: List[ParsedFeedback]
    mistakes: List[ParsedMistake]
    score: Optional[ParsedScore]
    concepts: List[ParsedConcept]
    approach_notes: Optional[str]


@dataclass
class ConversationMeta:
    conversation_id: str
    title: str
    create_time: Optional[datetime]
    relevance_score: float  # 0-100
    q_range: Optional[Tuple[int, int]]  # (min_q, max_q)
    message_count: int
    sql_block_count: int
    match_reasons: List[str]


@dataclass
class ParseResult:
    conversation: ConversationMeta
    questions: List[ParsedQuestion]
    total_attempts: int
    total_feedback: int
    total_mistakes: int
    total_scores: int
    total_concepts: int


# ---------------------------------------------------------------------------
# 1. ConversationLoader
# ---------------------------------------------------------------------------

SQL_KEYWORDS = {
    "select", "from", "where", "join", "inner join", "left join", "right join",
    "full outer join", "cross join", "group by", "having", "order by", "union",
    "union all", "intersect", "except", "with", "cte", "subquery", "window",
    "row_number", "rank", "dense_rank", "lag", "lead", "partition by",
}

NORTHWIND_TABLES = {
    "customers", "employees", "suppliers", "products", "categories",
    "orders", "order_details", "shippers",
}

TOPIC_KEYWORDS = {
    "conditional aggregation", "cte", "subquery", "cross join", "union all",
    "self join", "window function", "aggregation", "having", "group by",
}


def _ts_to_dt(ts: Any) -> Optional[datetime]:
    if ts is None:
        return None
    try:
        return datetime.fromtimestamp(float(ts), tz=timezone.utc)
    except Exception:
        return None


def _get_text(message: Optional[Dict]) -> str:
    if not message:
        return ""
    content = message.get("content") or {}
    if isinstance(content, str):
        return content
    parts = content.get("parts") or []
    segments = []
    for p in parts:
        if isinstance(p, str):
            segments.append(p)
        elif isinstance(p, dict):
            # audio/image parts — skip
            pass
    return "\n".join(segments)


def load_conversations(raw: Any) -> List[Dict]:
    """Accept array or object (single conv) format."""
    if isinstance(raw, list):
        return raw
    if isinstance(raw, dict):
        # Could be {"conversations": [...]} or a single conversation
        if "conversations" in raw:
            return raw["conversations"]
        # Single conversation object
        if "mapping" in raw:
            return [raw]
    return []


# ---------------------------------------------------------------------------
# 2. MessageTreeWalker
# ---------------------------------------------------------------------------


def walk_messages(conv: Dict) -> List[ParsedMessage]:
    """Walk the mapping tree and return messages in chronological order."""
    mapping: Dict[str, Dict] = conv.get("mapping") or {}
    if not mapping:
        return []

    # Build adjacency
    children_map: Dict[str, List[str]] = {}
    root_ids: List[str] = []
    for node_id, node in mapping.items():
        parent = node.get("parent")
        if parent is None or parent not in mapping:
            root_ids.append(node_id)
        else:
            children_map.setdefault(parent, []).append(node_id)

    # DFS traversal (always pick last child = canonical branch)
    ordered: List[ParsedMessage] = []
    visited: set = set()

    def _dfs(nid: str) -> None:
        if nid in visited:
            return
        visited.add(nid)
        node = mapping.get(nid) or {}
        msg = node.get("message")
        if msg:
            role = (msg.get("author") or {}).get("role", "")
            if role in ("user", "assistant", "system"):
                text = _get_text(msg)
                if text.strip():
                    ordered.append(
                        ParsedMessage(
                            msg_id=msg.get("id", nid),
                            role=role,
                            text=text,
                            create_time=_ts_to_dt(msg.get("create_time")),
                            node_id=nid,
                        )
                    )
        for child_id in children_map.get(nid, []):
            _dfs(child_id)

    for rid in root_ids:
        _dfs(rid)

    # Sort by create_time when available (tree order is usually correct)
    timed = [m for m in ordered if m.create_time is not None]
    untimed = [m for m in ordered if m.create_time is None]
    timed.sort(key=lambda m: m.create_time)  # type: ignore[arg-type]
    return timed + untimed


# ---------------------------------------------------------------------------
# 3. ConversationScorer
# ---------------------------------------------------------------------------

# Q-number patterns used everywhere
_Q_PATTERN = re.compile(
    r'\b(?:question\s*#?\s*|q\s*)(\d{1,4})\b',
    re.IGNORECASE,
)


def _count_sql_blocks(messages: List[ParsedMessage]) -> int:
    return sum(
        1
        for m in messages
        if re.search(r"```(?:sql)?", m.text, re.IGNORECASE)
        or re.search(
            r"^\s*(select|with\s+\w|\bselect\b)",
            m.text,
            re.IGNORECASE | re.MULTILINE,
        )
    )


def _find_q_range(messages: List[ParsedMessage]) -> Optional[Tuple[int, int]]:
    nums: set[int] = set()
    for m in messages:
        for match in _Q_PATTERN.finditer(m.text):
            n = int(match.group(1))
            if 1 <= n <= 999:
                nums.add(n)
    return (min(nums), max(nums)) if nums else None


def score_conversation(conv: Dict) -> ConversationMeta:
    title = conv.get("title", "") or ""
    messages = walk_messages(conv)
    full_text = " ".join(m.text for m in messages).lower()

    score = 0.0
    reasons: List[str] = []

    # Title keywords
    title_lower = title.lower()
    for kw in ["sql", "northwind", "query", "practice", "interview"]:
        if kw in title_lower:
            score += 15
            reasons.append(f"title contains '{kw}'")
            break

    # Northwind tables mentioned
    table_hits = sum(1 for t in NORTHWIND_TABLES if t in full_text)
    if table_hits >= 4:
        score += 25
        reasons.append(f"{table_hits} Northwind tables mentioned")
    elif table_hits >= 1:
        score += table_hits * 5

    # SQL keywords
    kw_hits = sum(1 for k in SQL_KEYWORDS if k in full_text)
    score += min(kw_hits * 1.5, 20)
    if kw_hits >= 5:
        reasons.append(f"{kw_hits} SQL keywords")

    # Q-numbers
    q_range = _find_q_range(messages)
    if q_range:
        span = q_range[1] - q_range[0] + 1
        score += min(span * 0.5, 15)
        reasons.append(f"Q{q_range[0]}–Q{q_range[1]}")

    # SQL blocks (code fences)
    sql_count = _count_sql_blocks(messages)
    if sql_count >= 5:
        score += 20
        reasons.append(f"{sql_count} SQL code blocks")
    elif sql_count >= 1:
        score += sql_count * 2

    # Topic keywords
    for kw in TOPIC_KEYWORDS:
        if kw in full_text:
            score += 3
            reasons.append(f"topic '{kw}'")
            break

    score = min(score, 100.0)

    return ConversationMeta(
        conversation_id=conv.get("id", ""),
        title=title,
        create_time=_ts_to_dt(conv.get("create_time")),
        relevance_score=round(score, 1),
        q_range=q_range,
        message_count=len(messages),
        sql_block_count=sql_count,
        match_reasons=reasons,
    )


# ---------------------------------------------------------------------------
# 4. QuestionBoundaryDetector
# ---------------------------------------------------------------------------

_Q_HEADER = re.compile(
    r"""
    (?:^|\n)                          # start of line
    (?:\#{1,4}\s*)?                   # optional ## heading
    (?:question\s*\#?\s*|q[\s.]*)     # "Question", "Q", "Q."
    (\d{1,4})                         # the number
    (?:[^a-z0-9]|$)                   # not followed by alphanumeric
    """,
    re.IGNORECASE | re.VERBOSE,
)

_IGNORED_PHRASES = re.compile(
    r"^\s*(next|ok|yes|no|sure|got it|thanks|continue|previous|back|same|wait|"
    r"what am i|what's wrong|help me|explain|why|how do|let me|i see|i understand|"
    r"understood|makes sense|try again|one more|again|retry)\b",
    re.IGNORECASE,
)


def _extract_q_number(text: str) -> Optional[int]:
    m = _Q_HEADER.search(text)
    if m:
        n = int(m.group(1))
        return n if 1 <= n <= 999 else None
    return None


def _is_filler(text: str) -> bool:
    stripped = text.strip()
    if len(stripped) < 80 and _IGNORED_PHRASES.match(stripped):
        return True
    # Very short with no SQL
    if len(stripped) < 30 and not re.search(r"\bselect\b|\bwith\b|\bjoin\b", stripped, re.I):
        return True
    return False


# ---------------------------------------------------------------------------
# 5. SqlBlockDetector
# ---------------------------------------------------------------------------

_CODE_FENCE = re.compile(r"```(?:sql)?\s*\n(.*?)```", re.DOTALL | re.IGNORECASE)

_INLINE_SQL = re.compile(
    r"""
    (?:^|\n)                          # beginning of a line
    \s*
    ((?:WITH\s+\w|SELECT\s+|SELECT\n) # starts with WITH or SELECT
    .*?)                              # rest of statement
    (?=\n\s*\n|\Z)                    # ends at blank line or EOF
    """,
    re.IGNORECASE | re.DOTALL | re.VERBOSE,
)


def extract_sql_blocks(text: str) -> List[str]:
    """Return list of SQL strings found in a message."""
    blocks: List[str] = []

    # Code fences first (most reliable)
    for m in _CODE_FENCE.finditer(text):
        sql = m.group(1).strip()
        if sql and len(sql) >= 10:
            blocks.append(sql)

    if blocks:
        return blocks

    # Fall back to inline SQL detection
    for m in _INLINE_SQL.finditer(text):
        sql = m.group(1).strip()
        if sql and len(sql) >= 20:
            # Sanity check: must have SELECT somewhere
            if re.search(r"\bselect\b", sql, re.IGNORECASE):
                blocks.append(sql)

    return blocks


# ---------------------------------------------------------------------------
# 6. Score extractor
# ---------------------------------------------------------------------------

_SCORE_PATTERNS = [
    re.compile(r"(?:score|interview score|rating)[:\s]+(\d+(?:\.\d+)?)\s*/\s*(\d+)", re.I),
    re.compile(r"(\d+(?:\.\d+)?)\s*/\s*(10)\b"),
    re.compile(r"⭐+"),
]


def extract_score(text: str, msg_id: str) -> Optional[ParsedScore]:
    for pat in _SCORE_PATTERNS[:-1]:
        m = pat.search(text)
        if m:
            try:
                score_val = float(m.group(1))
                max_val = float(m.group(2))
                return ParsedScore(
                    score=score_val,
                    max_score=max_val,
                    score_text=m.group(0).strip(),
                    source_message_id=msg_id,
                )
            except (ValueError, IndexError):
                pass
    # Star-based
    stars = re.search(r"(⭐+)", text)
    if stars:
        count = len(stars.group(1))
        return ParsedScore(
            score=float(count),
            max_score=5.0,
            score_text=stars.group(1),
            source_message_id=msg_id,
        )
    return None


# ---------------------------------------------------------------------------
# 7. Feedback extractor
# ---------------------------------------------------------------------------

_CORRECT_PHRASES = re.compile(
    r"\b(correct|well done|perfect|great|excellent|nice work|you got it|"
    r"your (query|solution|answer) is correct|that'?s? right|that works)\b",
    re.I,
)

_INCORRECT_PHRASES = re.compile(
    r"\b(incorrect|wrong|not quite|almost|doesn'?t? work|doesn'?t? produce|"
    r"not correct|the issue is|the problem is|your query fails|"
    r"your (query|solution|answer) is (incorrect|wrong|not))\b",
    re.I,
)

_HINT_PHRASES = re.compile(
    r"\b(think about|consider|try|instead of|you should|you could|use |"
    r"check (your|the)|remember that|note that)\b",
    re.I,
)

_CONCEPT_PHRASES = re.compile(
    r"\b(because|reason is|this is because|the difference|explanation|"
    r"what happens when|count\(\) vs sum\(\)|null values|non-null)\b",
    re.I,
)

_MISTAKE_PHRASES = re.compile(
    r"\b(mistake|error|wrong approach|the (issue|problem) is|"
    r"you (used|wrote|have)|instead of using|replace)\b",
    re.I,
)

_OPTIMIZATION_PHRASES = re.compile(
    r"\b(more efficient|optimize|better approach|alternatively|cleaner|"
    r"performance)\b",
    re.I,
)

_ENCOURAGEMENT_PHRASES = re.compile(
    r"\b(great progress|you'?re? getting|solid|good effort|keep going|"
    r"strong work)\b",
    re.I,
)


def classify_feedback(text: str) -> str:
    tl = text.lower()
    if _CORRECT_PHRASES.search(tl):
        return "correct"
    if _INCORRECT_PHRASES.search(tl):
        return "incorrect"
    if _MISTAKE_PHRASES.search(tl):
        return "mistake"
    if _CONCEPT_PHRASES.search(tl):
        return "concept_explanation"
    if _HINT_PHRASES.search(tl):
        return "hint"
    if _OPTIMIZATION_PHRASES.search(tl):
        return "optimization"
    if _ENCOURAGEMENT_PHRASES.search(tl):
        return "encouragement"
    return "general"


# ---------------------------------------------------------------------------
# 8. Mistake extractor
# ---------------------------------------------------------------------------

MISTAKE_CATEGORY_PATTERNS: List[Tuple[str, re.Pattern]] = [
    ("COUNT_VS_SUM", re.compile(r"\bcount\s*\(.*?\)\s*(?:vs|instead of|not)\s*sum\b|\bshould use sum\b|\buse sum\b", re.I)),
    ("NULL_HANDLING", re.compile(r"\bnull\b.*\b(handling|values|safe|coalesce|is null|is not null)\b", re.I)),
    ("GROUP_BY", re.compile(r"\bgroup\s*by\b.*\b(missing|wrong|incorrect|added|remove)\b|\b(missing|wrong)\b.*\bgroup\s*by\b", re.I)),
    ("HAVING", re.compile(r"\bhaving\b.*\b(where|instead|missing|use)\b|\buse having\b", re.I)),
    ("JOIN_LOGIC", re.compile(r"\b(join\s+(condition|logic|type)|wrong\s+join|missing\s+join|left join vs|inner join vs)\b", re.I)),
    ("UNION_ALL", re.compile(r"\bunion\s+all\b.*\b(instead of|not|should)\b|\bshould use union all\b", re.I)),
    ("UNION", re.compile(r"\bunion\b.*\b(deduplicates|removes duplicates|instead of)\b", re.I)),
    ("CTE", re.compile(r"\bwith\b.*\b(cte|common table|recursive)\b|\bcte\b.*\b(wrong|missing|issue)\b", re.I)),
    ("SUBQUERY", re.compile(r"\bsubquery\b.*\b(missing|wrong|correlated)\b", re.I)),
    ("ORDERING", re.compile(r"\border\s*by\b.*\b(missing|wrong|asc|desc)\b|\bmissing\b.*\border\b", re.I)),
    ("FILTERING", re.compile(r"\bwhere\b.*\b(missing|wrong|incorrect)\b|\bfilter\b.*\b(wrong|missing)\b", re.I)),
    ("DUPLICATES", re.compile(r"\bdistinct\b.*\b(missing|should|use)\b|\bduplicate\b.*\b(rows|values|results)\b", re.I)),
    ("ALIAS", re.compile(r"\balias\b.*\b(wrong|missing|conflict)\b|\bcolumn\s+name\b.*\b(wrong|mismatch)\b", re.I)),
    ("AGGREGATION", re.compile(r"\baggregate\b.*\b(wrong|missing|incorrect)\b|\b(sum|avg|max|min)\b.*\b(wrong|should)\b", re.I)),
    ("SYNTAX", re.compile(r"\bsyntax\s*error\b|\bmissing\s+(comma|parenthesis|keyword)\b", re.I)),
    ("DATA_MODELING", re.compile(r"\b(schema|table\s+structure|normali[sz]ation|foreign\s+key)\b.*\b(issue|wrong)\b", re.I)),
    ("CASE", re.compile(r"\bcase\b.*\b(when|then|else|end)\b.*\b(wrong|missing|issue)\b", re.I)),
]


def extract_mistake_category(text: str) -> str:
    for category, pattern in MISTAKE_CATEGORY_PATTERNS:
        if pattern.search(text):
            return category
    return "OTHER"


_MISTAKE_BLOCK = re.compile(
    r"(?:mistake|error|issue|problem|the (?:mistake|error|issue|problem) (?:is|was))[:]\s*(.+?)(?=\n\n|\n(?:correction|fix|solution|correct approach|instead)|\Z)",
    re.IGNORECASE | re.DOTALL,
)

_CORRECTION_BLOCK = re.compile(
    r"(?:correction|fix|correct approach|instead|you should|use instead|should use)[:]\s*(.+?)(?=\n\n|\Z)",
    re.IGNORECASE | re.DOTALL,
)


def extract_mistakes(text: str, msg_id: str) -> List[ParsedMistake]:
    mistakes: List[ParsedMistake] = []
    for m in _MISTAKE_BLOCK.finditer(text):
        desc = m.group(1).strip()[:600]
        category = extract_mistake_category(desc + " " + text[:200])
        correction_m = _CORRECTION_BLOCK.search(text[m.end():m.end() + 400])
        correction = correction_m.group(1).strip()[:400] if correction_m else None
        mistakes.append(
            ParsedMistake(
                category=category,
                description=desc,
                correction=correction,
                source_message_id=msg_id,
            )
        )
    # If no explicit block but we detect a mistake-like sentence
    if not mistakes and _INCORRECT_PHRASES.search(text):
        short_text = text[:400]
        mistakes.append(
            ParsedMistake(
                category=extract_mistake_category(short_text),
                description=short_text.strip()[:400],
                correction=None,
                source_message_id=msg_id,
            )
        )
    return mistakes


# ---------------------------------------------------------------------------
# 9. Concept extractor
# ---------------------------------------------------------------------------

KNOWN_CONCEPTS = [
    "SELF JOIN", "CROSS JOIN", "INNER JOIN", "LEFT JOIN", "RIGHT JOIN",
    "FULL OUTER JOIN", "CTE", "SUBQUERY", "CORRELATED SUBQUERY",
    "WINDOW FUNCTIONS", "ROW_NUMBER", "RANK", "DENSE_RANK", "LAG", "LEAD",
    "PARTITION BY", "UNION", "UNION ALL", "INTERSECT", "EXCEPT",
    "CONDITIONAL AGGREGATION", "GROUP BY", "HAVING", "ORDER BY",
    "SUM(CASE)", "COUNT(CASE)", "COALESCE", "NULL HANDLING",
    "DISTINCT", "AGGREGATION", "DATE FUNCTIONS", "STRING FUNCTIONS",
    "ADVANCED CTE", "ADVANCED SUBQUERY", "PIVOTING", "UNPIVOTING",
    "EXISTS", "NOT EXISTS", "IN", "NOT IN",
]


def extract_concepts(text: str, msg_id: str) -> List[ParsedConcept]:
    concepts: List[ParsedConcept] = []
    text_upper = text.upper()
    for concept in KNOWN_CONCEPTS:
        if concept in text_upper:
            # Try to extract a surrounding sentence as description
            pattern = re.compile(re.escape(concept), re.IGNORECASE)
            m = pattern.search(text)
            if m:
                start = max(0, m.start() - 80)
                end = min(len(text), m.end() + 150)
                desc = text[start:end].strip()
                concepts.append(
                    ParsedConcept(name=concept, description=desc, source_message_id=msg_id)
                )
    return concepts


# ---------------------------------------------------------------------------
# 10. Topic / difficulty inference
# ---------------------------------------------------------------------------

TOPIC_INFERENCE_MAP = [
    ("CONDITIONAL AGGREGATION", ["conditional aggregation", "sum(case", "count(case", "filter (where"]),
    ("WINDOW FUNCTIONS", ["row_number", "rank()", "dense_rank", "lag(", "lead(", "partition by", "over ("]),
    ("CTE", ["with ", "common table", "recursive"]),
    ("SUBQUERIES", ["subquery", "correlated", "exists (", "not exists", "in (select"]),
    ("SELF JOIN", ["self join", "e1.employee_id", "join employees e2", "pairs of"]),
    ("CROSS JOIN", ["cross join"]),
    ("UNION ALL", ["union all"]),
    ("UNION", ["union\n", "union ", " union"]),
    ("LEFT JOIN", ["left join", "left outer"]),
    ("GROUP BY", ["group by"]),
    ("HAVING", ["having"]),
    ("AGGREGATION", ["count(", "sum(", "avg(", "max(", "min("]),
    ("SELECT", ["select"]),
]

DIFFICULTY_INFERENCE_MAP = [
    ("Expert", ["recursive", "window function", "row_number", "dense_rank", "pivot"]),
    ("Senior", ["conditional aggregation", "multiple cte", "correlated subquery", "self join"]),
    ("Advanced", ["cte", "subquery", "cross join", "union all", "union"]),
    ("Intermediate", ["left join", "right join", "full outer", "group by", "having"]),
    ("Beginner", ["select", "where", "order by", "limit"]),
]


def infer_topic(text: str) -> Optional[str]:
    text_lower = text.lower()
    for topic, keywords in TOPIC_INFERENCE_MAP:
        if any(kw in text_lower for kw in keywords):
            return topic
    return None


def infer_difficulty(text: str) -> Optional[str]:
    text_lower = text.lower()
    for difficulty, keywords in DIFFICULTY_INFERENCE_MAP:
        if any(kw in text_lower for kw in keywords):
            return difficulty
    return None


# ---------------------------------------------------------------------------
# Question intro extractor
# ---------------------------------------------------------------------------

_BUSINESS_SECTION = re.compile(
    r"(?:business\s+(?:problem|scenario|case|need|requirement)|scenario|situation)[:\s]*(.+?)(?=\n(?:requirement|table|column|note|hint|difficulty|\Z))",
    re.IGNORECASE | re.DOTALL,
)

_REQUIREMENTS_BULLETS = re.compile(
    r"(?:^|\n)\s*[-•*]\s*(.+)",
    re.MULTILINE,
)

_TABLES_SECTION = re.compile(
    r"(?:tables?\s+used|use(?:d)?\s+tables?|from\s+(?:tables?|the\s+following))[:]\s*\n?(.*?)(?=\n\n|\Z)",
    re.IGNORECASE | re.DOTALL,
)

_DIFFICULTY_EXPLICIT = re.compile(
    r"(?:difficulty|level)[:\s]+(beginner|intermediate|advanced|senior|expert)\b",
    re.IGNORECASE,
)

_TOPIC_EXPLICIT = re.compile(
    r"(?:topic|concept|category)[:\s]+([A-Za-z\s/]+?)(?:\n|$)",
    re.IGNORECASE,
)

_TITLE_LINE = re.compile(
    r"(?:^|\n)\s*(?:Q\d+[.\s]+|question\s*\d+\s*[.\-—:]+)\s*(.+)",
    re.IGNORECASE,
)

NORTHWIND_TABLE_LIST = list(NORTHWIND_TABLES)


def parse_question_intro(text: str, q_num: int) -> dict:
    """Extract structured fields from an assistant question-intro message."""
    result: dict = {
        "title": None,
        "business_problem": None,
        "requirements": [],
        "tables_used": [],
        "difficulty": None,
        "topic": None,
        "subtopic": None,
    }

    # Title
    title_m = _TITLE_LINE.search(text)
    if title_m:
        candidate = title_m.group(1).strip()
        # Reject if it looks like a sentence
        if len(candidate) < 120 and "." not in candidate[:40]:
            result["title"] = candidate

    # Difficulty (explicit)
    diff_m = _DIFFICULTY_EXPLICIT.search(text)
    if diff_m:
        result["difficulty"] = diff_m.group(1).strip().title()

    # Topic (explicit)
    topic_m = _TOPIC_EXPLICIT.search(text)
    if topic_m:
        result["topic"] = topic_m.group(1).strip()

    # Business problem
    bp_m = _BUSINESS_SECTION.search(text)
    if bp_m:
        result["business_problem"] = bp_m.group(1).strip()[:800]
    elif not result["business_problem"]:
        # Use first non-header paragraph
        paras = [p.strip() for p in text.split("\n\n") if p.strip()]
        for p in paras[1:3]:
            if len(p) > 40 and not p.startswith("#") and not p.startswith("Q"):
                result["business_problem"] = p[:800]
                break

    # Requirements
    reqs = [m.group(1).strip() for m in _REQUIREMENTS_BULLETS.finditer(text)]
    result["requirements"] = reqs[:12]

    # Tables used
    tables_m = _TABLES_SECTION.search(text)
    if tables_m:
        raw_tables = tables_m.group(1)
        found = [
            t
            for t in NORTHWIND_TABLE_LIST
            if t in raw_tables.lower()
        ]
        result["tables_used"] = found
    if not result["tables_used"]:
        # Scan the whole text
        result["tables_used"] = [
            t for t in NORTHWIND_TABLE_LIST if t in text.lower()
        ]

    return result


# ---------------------------------------------------------------------------
# Main parser
# ---------------------------------------------------------------------------


class ChatGPTParser:
    def __init__(self, start_question: int = 59):
        self.start_question = start_question

    # ------------------------------------------------------------------
    # Public API
    # ------------------------------------------------------------------

    def scan(self, raw_data: Any) -> List[ConversationMeta]:
        """Score all conversations and return sorted by relevance."""
        convs = load_conversations(raw_data)
        results: List[ConversationMeta] = []
        for conv in convs:
            try:
                meta = score_conversation(conv)
                results.append(meta)
            except Exception:
                pass
        results.sort(key=lambda c: c.relevance_score, reverse=True)
        return results

    def parse(
        self,
        raw_data: Any,
        conversation_id: str,
        start_question: Optional[int] = None,
    ) -> ParseResult:
        """Full parse of a selected conversation."""
        convs = load_conversations(raw_data)
        conv = next(
            (c for c in convs if c.get("id") == conversation_id), None
        )
        if conv is None:
            raise ValueError(f"Conversation {conversation_id!r} not found")

        sq = start_question if start_question is not None else self.start_question
        meta = score_conversation(conv)
        messages = walk_messages(conv)
        questions = self._parse_questions(messages, sq)

        return ParseResult(
            conversation=meta,
            questions=questions,
            total_attempts=sum(len(q.attempts) for q in questions),
            total_feedback=sum(len(q.feedback) for q in questions),
            total_mistakes=sum(len(q.mistakes) for q in questions),
            total_scores=sum(1 for q in questions if q.score is not None),
            total_concepts=sum(len(q.concepts) for q in questions),
        )

    # ------------------------------------------------------------------
    # Internal parsing pipeline
    # ------------------------------------------------------------------

    def _parse_questions(
        self, messages: List[ParsedMessage], start_q: int
    ) -> List[ParsedQuestion]:
        """Segment messages by question and build ParsedQuestion objects."""

        # Step 1: segment the message stream into question blocks
        segments = self._segment_by_question(messages, start_q)

        parsed: List[ParsedQuestion] = []
        prev_q_num = start_q - 1

        for q_num, q_num_source, q_messages in segments:
            if q_num is None:
                q_num = prev_q_num + 1
                q_num_source = "inferred"

            prev_q_num = q_num
            pq = self._parse_one_question(q_num, q_num_source, q_messages)
            if pq is not None:
                parsed.append(pq)

        return parsed

    def _segment_by_question(
        self,
        messages: List[ParsedMessage],
        start_q: int,
    ) -> List[Tuple[Optional[int], str, List[ParsedMessage]]]:
        """Return list of (q_num, source, messages) segments."""

        segments: List[Tuple[Optional[int], str, List[ParsedMessage]]] = []
        current_q: Optional[int] = None
        current_source = "explicit"
        current_msgs: List[ParsedMessage] = []
        started = False

        for msg in messages:
            if msg.role == "system":
                continue

            # Detect question boundary in assistant or user messages
            q_in_msg = _extract_q_number(msg.text)

            if q_in_msg is not None and q_in_msg >= start_q:
                if current_q is not None or started:
                    # Save previous segment
                    if current_msgs:
                        segments.append((current_q, current_source, current_msgs))
                current_q = q_in_msg
                current_source = "explicit"
                current_msgs = [msg]
                started = True
            elif started:
                current_msgs.append(msg)

        if current_msgs:
            segments.append((current_q, current_source, current_msgs))

        return segments

    def _parse_one_question(
        self,
        q_num: int,
        q_num_source: str,
        messages: List[ParsedMessage],
    ) -> Optional[ParsedQuestion]:
        if not messages:
            return None

        # Collect intro text from the first assistant message
        intro_text = ""
        intro_msg_ids: List[str] = []
        for msg in messages:
            if msg.role == "assistant":
                intro_text = msg.text
                intro_msg_ids.append(msg.msg_id)
                break

        if not intro_text:
            intro_text = next(
                (m.text for m in messages if m.role in ("assistant", "user")),
                "",
            )

        all_msg_ids = [m.msg_id for m in messages]
        meta = parse_question_intro(intro_text, q_num)

        # Infer topic/difficulty if not explicit
        full_text = " ".join(m.text for m in messages)
        suggested_topic = infer_topic(full_text) if not meta["topic"] else None
        suggested_diff = (
            infer_difficulty(full_text) if not meta["difficulty"] else None
        )

        # Extract attempts (SQL blocks from user messages)
        attempts: List[ParsedAttempt] = []
        approach_notes_list: List[str] = []
        attempt_num = 0

        for msg in messages:
            if msg.role != "user":
                continue
            if _is_filler(msg.text):
                # Capture approach notes from non-filler, non-SQL user messages
                continue

            sql_blocks = extract_sql_blocks(msg.text)

            # Check for approach discussion (user text before SQL)
            text_before_sql = msg.text
            if sql_blocks:
                first_fence = msg.text.find("```")
                first_kw_m = re.search(
                    r"^\s*(select|with\s+\w)", msg.text, re.I | re.M
                )
                cut = min(
                    first_fence if first_fence >= 0 else len(msg.text),
                    first_kw_m.start() if first_kw_m else len(msg.text),
                )
                text_before_sql = msg.text[:cut].strip()

            if (
                text_before_sql.strip()
                and len(text_before_sql.strip()) > 20
                and not re.fullmatch(r"\s*[\n\r\s]*", text_before_sql)
            ):
                approach_notes_list.append(text_before_sql.strip())

            for sql in sql_blocks:
                attempt_num += 1
                attempts.append(
                    ParsedAttempt(
                        sql=sql,
                        attempt_number=attempt_num,
                        source_message_id=msg.msg_id,
                        approach_notes=text_before_sql.strip() or None,
                    )
                )

        # Extract feedback, scores, mistakes, concepts from assistant messages
        # and associate with the most recent attempt
        question_feedback: List[ParsedFeedback] = []
        question_mistakes: List[ParsedMistake] = []
        question_score: Optional[ParsedScore] = None
        question_concepts: List[ParsedConcept] = []

        last_attempt_idx = -1
        attempt_ptr = 0  # track which attempt we're commenting on

        for msg in messages:
            if msg.role != "assistant":
                continue

            text = msg.text

            # Score
            sc = extract_score(text, msg.msg_id)
            if sc is not None:
                question_score = sc
                # Attach to most recent attempt
                if attempts:
                    target = min(attempt_ptr, len(attempts) - 1)
                    attempts[target].score = sc
                    if attempts[target].is_correct is None:
                        attempts[target].is_correct = True

            # Feedback type
            fb_type = classify_feedback(text)
            # Attach correctness to most recent attempt
            if attempts and attempt_ptr < len(attempts):
                if fb_type == "correct":
                    attempts[attempt_ptr].is_correct = True
                elif fb_type == "incorrect":
                    attempts[attempt_ptr].is_correct = False
                if fb_type in ("correct", "incorrect", "partial"):
                    attempt_ptr = min(attempt_ptr + 1, len(attempts))

            # Feedback object
            fb = ParsedFeedback(
                feedback_type=fb_type,
                feedback_text=text[:1500].strip(),
                source_message_id=msg.msg_id,
            )
            question_feedback.append(fb)
            if attempts:
                target = min(attempt_ptr, len(attempts) - 1)
                if target >= 0:
                    attempts[target].feedbacks.append(fb)

            # Mistakes
            for m_item in extract_mistakes(text, msg.msg_id):
                question_mistakes.append(m_item)
                if attempts:
                    target = min(attempt_ptr, len(attempts) - 1)
                    if target >= 0:
                        attempts[target].mistakes.append(m_item)

            # Concepts
            for c in extract_concepts(text, msg.msg_id):
                if not any(x.name == c.name for x in question_concepts):
                    question_concepts.append(c)

        approach_notes_combined = (
            " | ".join(dict.fromkeys(approach_notes_list))[:800]
            if approach_notes_list
            else None
        )

        return ParsedQuestion(
            question_number=q_num,
            question_number_source=q_num_source,
            title=meta["title"] or f"Question {q_num}",
            business_problem=meta["business_problem"],
            requirements=meta["requirements"],
            tables_used=meta["tables_used"],
            difficulty=meta["difficulty"],
            topic=meta["topic"],
            subtopic=meta["subtopic"],
            suggested_difficulty=suggested_diff,
            suggested_topic=suggested_topic,
            source_message_ids=all_msg_ids,
            original_text=intro_text[:3000],
            attempts=attempts,
            feedback=question_feedback,
            mistakes=question_mistakes,
            score=question_score,
            concepts=question_concepts,
            approach_notes=approach_notes_combined,
        )
