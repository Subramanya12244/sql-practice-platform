"""Parse Git Practice Lab exercises from Markdown content files.

Supports two formats:

1) Strict importer format (`# Module` / `## Exercise` / `### Title`)
2) Data-engineering bank format (`## Module` / `### Exercise` / `**Title:**` / `#### Task`)
"""

from __future__ import annotations

import json
import re
from dataclasses import dataclass, field
from typing import Any, Dict, List, Tuple

from app.services.git_lab.curriculum import (
    VALID_DIFFICULTIES,
    VALID_TYPES,
    normalize_difficulty,
    normalize_type,
    slugify_module,
)

# H1 or H2 module headings
MODULE_RE = re.compile(
    r"^#{1,2}\s+Module:\s*(.+?)\s*$", re.IGNORECASE | re.MULTILINE
)
# H2 or H3 exercise headings
EXERCISE_RE = re.compile(
    r"^#{2,3}\s+Exercise:\s*([A-Za-z0-9._-]+)\s*$", re.IGNORECASE | re.MULTILINE
)
# H3 or H4 section headings
SECTION_RE = re.compile(r"^#{3,4}\s+(.+?)\s*$", re.MULTILINE)
# Inline bold metadata: **Title:** value
BOLD_FIELD_RE = re.compile(
    r"^\*\*(Title|Type|Difficulty|Concepts|Tags)\*\*:\s*(.+?)\s*$",
    re.IGNORECASE | re.MULTILINE,
)

SECTION_ALIASES = {
    "title": "title",
    "type": "type",
    "exercise type": "type",
    "difficulty": "difficulty",
    "concepts": "concepts",
    "tags": "tags",
    "scenario": "scenario",
    "objective": "objective",
    "task": "task",
    "expected answer": "expected_answer",
    "expected answers": "expected_answer",
    "expected outcome": "expected_outcome",
    "accepted solutions": "accepted_solutions",
    "explanation": "explanation",
    "hint": "hints",
    "hints": "hints",
    "hint 1": "hints",
    "hint 2": "hints",
    "hint 3": "hints",
    "common mistakes": "common_mistakes",
    "initial repository state": "repository_state",
    "repository state": "repository_state",
    "expected repository state": "expected_state",
    "expected state": "expected_state",
    "choices": "choices",
    "options": "choices",
    "validation": "validation",
}

# Generic boilerplate outcomes from scaffold banks — not real answers
GENERIC_OUTCOME_RE = re.compile(
    r"repository should be in the state requested|no unintended files",
    re.IGNORECASE,
)

CONCEPTUAL_RE = re.compile(
    r"^(what|why|how does|how do|explain|describe|define|compare|when (do|should|would)|difference between)\b",
    re.IGNORECASE,
)

# Phrase → preferred git command(s) for scaffold banks missing concrete answers
COMMAND_INFERENCE: List[Tuple[re.Pattern[str], List[str]]] = [
    (re.compile(r"\bgit status\b|check (the )?(current )?state|repository status|what information does git status", re.I), ["git status"]),
    (re.compile(r"\binit(ialize)? (a )?repo|create (a )?new repository|git init\b", re.I), ["git init"]),
    (re.compile(r"stage only |stage (the )?file|git add [^\s]|add .+ to (the )?staging", re.I), []),  # needs path — skip generic
    (re.compile(r"\bstage all\b|stage everything|add all changes", re.I), ["git add .", "git add -A", "git add --all"]),
    (re.compile(r"\bunstage\b|remove .+ from (the )?staging|restore --staged", re.I), ["git restore --staged", "git reset HEAD"]),
    (re.compile(r"\bcommit\b.*\bmessage\b|create a commit|make a commit", re.I), ["git commit -m"]),
    (re.compile(r"\bgit log\b|view (commit )?history|oneline (commit )?log|compact history", re.I), ["git log", "git log --oneline"]),
    (re.compile(r"staged diff|diff --staged|diff --cached|inspect staged", re.I), ["git diff --staged", "git diff --cached"]),
    (re.compile(r"\bgit diff\b|unstaged (diff|changes)|show (the )?unstaged", re.I), ["git diff"]),
    (re.compile(r"create and switch|switch -c|checkout -b|new feature branch", re.I), ["git switch -c", "git checkout -b"]),
    (re.compile(r"list (local )?branches|\bgit branch\b(?! -)", re.I), ["git branch"]),
    (re.compile(r"delete (a |the )?branch|branch -d|branch -D", re.I), ["git branch -d", "git branch -D"]),
    (re.compile(r"\bswitch (to )?(branch|)|checkout (a |the )?branch", re.I), ["git switch", "git checkout"]),
    (re.compile(r"\bmerge\b", re.I), ["git merge"]),
    (re.compile(r"\bfetch\b", re.I), ["git fetch"]),
    (re.compile(r"\bpull\b", re.I), ["git pull"]),
    (re.compile(r"\bpush\b", re.I), ["git push"]),
    (re.compile(r"remote add|add (an? )?origin|add (a )?remote", re.I), ["git remote add"]),
    (re.compile(r"list remotes|remote -v|\bgit remote\b", re.I), ["git remote -v", "git remote"]),
    (re.compile(r"stash list|list (your )?stash", re.I), ["git stash list"]),
    (re.compile(r"stash pop|apply and remove|remove the latest stash", re.I), ["git stash pop"]),
    (re.compile(r"stash apply|keeping it in the stash", re.I), ["git stash apply"]),
    (re.compile(r"\bstash\b|temporarily save uncommitted", re.I), ["git stash", "git stash push"]),
    (re.compile(r"\brebase\b", re.I), ["git rebase"]),
    (re.compile(r"cherry-pick|cherrypick", re.I), ["git cherry-pick"]),
    (re.compile(r"\breflog\b", re.I), ["git reflog"]),
    (re.compile(r"\brevert\b", re.I), ["git revert"]),
    (re.compile(r"reset --soft|soft reset", re.I), ["git reset --soft"]),
    (re.compile(r"reset --hard|hard reset", re.I), ["git reset --hard"]),
    (re.compile(r"reset --mixed|mixed reset|\bgit reset\b", re.I), ["git reset", "git reset --mixed"]),
    (re.compile(r"\brestore\b|discard .+ changes|discard changes to", re.I), ["git restore"]),
    (re.compile(r"\bclone\b", re.I), ["git clone"]),
    (re.compile(r"\btag\b", re.I), ["git tag"]),
    (re.compile(r"\.gitignore|gitignore", re.I), [".gitignore"]),
]


@dataclass
class ParsedExercise:
    exercise_code: str
    module_title: str
    module_slug: str
    title: str = ""
    exercise_type: str = "command"
    difficulty: str = "Easy"
    concepts: List[str] = field(default_factory=list)
    tags: List[str] = field(default_factory=list)
    scenario: str = ""
    objective: str = ""
    task: str = ""
    expected_answer: str = ""
    accepted_solutions: List[str] = field(default_factory=list)
    explanation: str = ""
    hints: List[str] = field(default_factory=list)
    common_mistakes: List[str] = field(default_factory=list)
    repository_state: Dict[str, Any] = field(default_factory=dict)
    expected_state: Dict[str, Any] = field(default_factory=dict)
    choices: List[Dict[str, Any]] = field(default_factory=list)
    source_section: str = ""
    open_response: bool = False
    errors: List[str] = field(default_factory=list)
    warnings: List[str] = field(default_factory=list)

    @property
    def stable_id(self) -> str:
        return f"{self.module_slug}:{self.exercise_code}"

    def to_dict(self) -> Dict[str, Any]:
        return {
            "stable_id": self.stable_id,
            "exercise_code": self.exercise_code,
            "module_title": self.module_title,
            "module_slug": self.module_slug,
            "title": self.title,
            "exercise_type": self.exercise_type,
            "difficulty": self.difficulty,
            "concepts": self.concepts,
            "tags": self.tags,
            "scenario": self.scenario,
            "objective": self.objective,
            "task": self.task,
            "expected_answer": self.expected_answer,
            "accepted_solutions": self.accepted_solutions,
            "explanation": self.explanation,
            "hints": self.hints,
            "common_mistakes": self.common_mistakes,
            "repository_state": self.repository_state,
            "expected_state": self.expected_state,
            "choices": self.choices,
            "source_section": self.source_section,
            "open_response": self.open_response,
            "errors": self.errors,
            "warnings": self.warnings,
        }


@dataclass
class ParseResult:
    modules: List[Dict[str, str]]
    exercises: List[ParsedExercise]
    raw_module_count: int
    raw_exercise_count: int


def parse_git_markdown(text: str, filename: str = "") -> ParseResult:
    text = text.replace("\r\n", "\n").replace("\r", "\n")
    if not text.strip():
        return ParseResult(modules=[], exercises=[], raw_module_count=0, raw_exercise_count=0)

    module_matches = list(MODULE_RE.finditer(text))
    if not module_matches:
        blocks = [(filename or "Imported Module", text)]
    else:
        blocks = []
        for i, m in enumerate(module_matches):
            start = m.start()
            end = module_matches[i + 1].start() if i + 1 < len(module_matches) else len(text)
            blocks.append((m.group(1).strip(), text[start:end]))

    modules_meta: List[Dict[str, str]] = []
    exercises: List[ParsedExercise] = []
    seen_stable: set[str] = set()

    for module_title, block in blocks:
        module_slug = slugify_module(module_title)
        modules_meta.append({"title": module_title, "slug": module_slug})

        ex_matches = list(EXERCISE_RE.finditer(block))
        for i, em in enumerate(ex_matches):
            ex_start = em.end()
            ex_end = ex_matches[i + 1].start() if i + 1 < len(ex_matches) else len(block)
            body = block[ex_start:ex_end]
            code = em.group(1).strip()
            parsed = _parse_exercise_body(body, code, module_title, module_slug)
            parsed.source_section = f"Exercise: {code}"
            _enrich_from_scaffold(parsed)
            if parsed.stable_id in seen_stable:
                parsed.errors.append(f"Duplicate exercise ID in file: {parsed.stable_id}")
            seen_stable.add(parsed.stable_id)
            _validate_exercise(parsed)
            exercises.append(parsed)

    uniq_modules = []
    seen_m = set()
    for m in modules_meta:
        if m["slug"] not in seen_m:
            uniq_modules.append(m)
            seen_m.add(m["slug"])

    return ParseResult(
        modules=uniq_modules,
        exercises=exercises,
        raw_module_count=len(uniq_modules),
        raw_exercise_count=len(exercises),
    )


def _parse_exercise_body(
    body: str, code: str, module_title: str, module_slug: str
) -> ParsedExercise:
    ex = ParsedExercise(
        exercise_code=code, module_title=module_title, module_slug=module_slug
    )

    # Bold inline fields (**Title:** …)
    for m in BOLD_FIELD_RE.finditer(body):
        key = m.group(1).lower()
        val = m.group(2).strip()
        if key == "title":
            ex.title = val
        elif key == "type":
            ex.exercise_type = normalize_type(val)
        elif key == "difficulty":
            ex.difficulty = normalize_difficulty(val)
        elif key == "concepts":
            ex.concepts = _split_list(val)
        elif key == "tags":
            ex.tags = _split_list(val)

    sections = _split_sections(body)
    hint_parts: List[str] = []
    for key, content in sections.items():
        content = content.strip()
        if key == "title" and not ex.title:
            ex.title = _first_line(content)
        elif key == "type" and not ex.exercise_type:
            ex.exercise_type = normalize_type(_first_line(content))
        elif key == "difficulty":
            ex.difficulty = normalize_difficulty(_first_line(content))
        elif key == "concepts" and not ex.concepts:
            ex.concepts = _split_list(content)
        elif key == "tags" and not ex.tags:
            ex.tags = _split_list(content)
        elif key == "scenario":
            ex.scenario = content
        elif key == "objective":
            ex.objective = content
        elif key == "task":
            ex.task = content
        elif key in {"expected_answer", "expected_outcome"}:
            if GENERIC_OUTCOME_RE.search(content):
                ex.warnings.append("Generic expected outcome — will infer answer from task when possible")
            else:
                answers = _split_list(content)
                if answers:
                    ex.expected_answer = answers[0]
                    ex.accepted_solutions = answers
                elif content:
                    ex.expected_answer = content
                    ex.accepted_solutions = [content]
        elif key == "accepted_solutions":
            ex.accepted_solutions = _split_list(content) or ([content] if content else [])
        elif key == "explanation":
            ex.explanation = content
        elif key == "hints":
            if content:
                hint_parts.append(content)
        elif key == "common_mistakes":
            ex.common_mistakes = _split_list(content)
        elif key == "repository_state":
            ex.repository_state = _parse_json_block(content, ex, "repository_state")
        elif key == "expected_state":
            ex.expected_state = _parse_json_block(content, ex, "expected_state")
        elif key == "choices":
            ex.choices = _parse_choices(content)

    # Ordered hints from Hint 1 / Hint 2 headings
    ordered_hints = []
    for raw_key, content in _iter_raw_sections(body):
        alias = SECTION_ALIASES.get(raw_key.lower().strip())
        if alias == "hints" and content.strip():
            ordered_hints.append(content.strip())
    if ordered_hints:
        ex.hints = ordered_hints
    elif hint_parts:
        ex.hints = hint_parts

    return ex


def _enrich_from_scaffold(ex: ParsedExercise) -> None:
    """Infer type/answers for scaffold banks with generic outcomes."""
    blob = f"{ex.title}\n{ex.task}"
    if not ex.title and ex.task:
        ex.title = _first_line(ex.task)[:120]

    # Conceptual questions → open-response interpretation
    if CONCEPTUAL_RE.search(ex.task.strip()) or CONCEPTUAL_RE.search(ex.title.strip()):
        if ex.exercise_type == "command":
            ex.exercise_type = "output_interpretation"
        ex.open_response = True
        if not ex.expected_answer:
            # Keyword checklist from concepts / title for soft grading
            keys = ex.concepts or re.findall(r"[A-Za-z][A-Za-z0-9_-]{2,}", ex.title)
            ex.expected_answer = ", ".join(keys[:8]) if keys else ex.task.strip()
            ex.accepted_solutions = [ex.expected_answer]
            ex.warnings.append("Open-response conceptual question (keyword soft-grade)")
        return

    if ex.expected_answer or ex.accepted_solutions or ex.expected_state:
        return

    inferred = _infer_commands(blob)
    if inferred:
        ex.expected_answer = inferred[0]
        ex.accepted_solutions = inferred
        if ex.exercise_type == "scenario":
            pass
        elif ex.exercise_type not in VALID_TYPES:
            ex.exercise_type = "command"
        ex.warnings.append(f"Inferred expected answer: {inferred[0]}")
    else:
        # Actionable but no inference — keep as scenario open response
        if ex.exercise_type == "command":
            ex.exercise_type = "scenario"
        ex.open_response = True
        ex.expected_answer = ex.task.strip()
        ex.accepted_solutions = [ex.task.strip()]
        ex.warnings.append("No concrete command inferred — open-response scenario grading")


def _infer_commands(text: str) -> List[str]:
    for pattern, cmds in COMMAND_INFERENCE:
        if pattern.search(text) and cmds:
            return cmds
    # Direct "git …" inside title/task
    m = re.search(r"\b(git\s+[a-z-]+(?:\s+[^\n]+)?)", text, re.I)
    if m:
        cmd = " ".join(m.group(1).split())
        # trim trailing punctuation
        cmd = cmd.rstrip(".:")
        return [cmd]
    return []


def _split_sections(body: str) -> Dict[str, str]:
    matches = list(SECTION_RE.finditer(body))
    out: Dict[str, str] = {}
    for i, m in enumerate(matches):
        raw = m.group(1).strip()
        # Normalize "Hint 1" → hints
        key = SECTION_ALIASES.get(raw.lower())
        if not key and re.match(r"^hint\s*\d+$", raw.lower()):
            key = "hints"
        if not key:
            continue
        start = m.end()
        end = matches[i + 1].start() if i + 1 < len(matches) else len(body)
        if key == "hints":
            # accumulate later via ordered pass
            out.setdefault("hints", "")
            continue
        out[key] = body[start:end]
    return out


def _iter_raw_sections(body: str) -> List[Tuple[str, str]]:
    matches = list(SECTION_RE.finditer(body))
    pairs = []
    for i, m in enumerate(matches):
        start = m.end()
        end = matches[i + 1].start() if i + 1 < len(matches) else len(body)
        pairs.append((m.group(1).strip(), body[start:end]))
    return pairs


def _first_line(content: str) -> str:
    for line in content.splitlines():
        line = line.strip().strip("`")
        if line:
            return line
    return ""


def _split_list(content: str) -> List[str]:
    items: List[str] = []
    for line in content.splitlines():
        line = line.strip()
        if not line:
            continue
        line = re.sub(r"^[-*+\d.)\]]\s+", "", line)
        line = line.strip().strip("`")
        if "," in line and not line.startswith("git "):
            parts = [p.strip().strip("`") for p in line.split(",") if p.strip()]
            items.extend(parts)
        elif line:
            items.append(line)
    seen = set()
    out = []
    for i in items:
        if i not in seen:
            out.append(i)
            seen.add(i)
    return out


def _parse_json_block(content: str, ex: ParsedExercise, field: str) -> Dict[str, Any]:
    content = content.strip()
    if not content:
        return {}
    fence = re.search(r"```(?:json)?\s*([\s\S]*?)```", content, re.IGNORECASE)
    raw = fence.group(1).strip() if fence else content
    try:
        data = json.loads(raw)
        if not isinstance(data, dict):
            ex.errors.append(f"{field} must be a JSON object")
            return {}
        return data
    except json.JSONDecodeError as exc:
        ex.errors.append(f"Invalid JSON in {field}: {exc}")
        return {}


def _parse_choices(content: str) -> List[Dict[str, Any]]:
    choices = []
    for line in content.splitlines():
        line = line.strip()
        if not line:
            continue
        m = re.match(r"^(?:[-*+]|\(?([A-Da-d])\)?[.)])\s*(.+)$", line)
        if m:
            key = (m.group(1) or chr(ord("A") + len(choices))).upper()
            text = m.group(2).strip()
            correct = text.endswith("✓") or text.lower().endswith("(correct)")
            text = re.sub(r"\s*(\(correct\)|✓)\s*$", "", text, flags=re.I).strip()
            choices.append({"key": key, "text": text, "correct": correct})
        else:
            choices.append({"key": chr(ord("A") + len(choices)), "text": line, "correct": False})
    return choices


def _validate_exercise(ex: ParsedExercise) -> None:
    if not ex.title:
        ex.errors.append("Missing title")
    if not ex.task:
        ex.errors.append("Missing task")
    if not ex.exercise_type:
        ex.errors.append("Missing type")
    elif ex.exercise_type not in VALID_TYPES:
        ex.errors.append(f"Invalid type: {ex.exercise_type}")
    if ex.difficulty not in VALID_DIFFICULTIES:
        ex.errors.append(f"Invalid difficulty: {ex.difficulty}")

    if ex.open_response:
        # Open responses are importable without a concrete command answer
        if not ex.expected_answer and not ex.accepted_solutions:
            ex.warnings.append("Open response with no keyword checklist")
        return

    needs_answer = ex.exercise_type in {
        "command",
        "multiple_choice",
        "output_interpretation",
        "state_prediction",
        "debugging",
        "command_comparison",
        "scenario",
        "multi_step",
        "terminal",
    }
    if needs_answer and not ex.expected_answer and not ex.accepted_solutions:
        if ex.exercise_type in {"command", "scenario", "repository_state", "terminal", "multi_step"}:
            if not ex.expected_state:
                ex.errors.append("Missing expected answer (or expected repository state)")
        else:
            ex.errors.append("Missing expected answer")

    if ex.exercise_type == "multiple_choice" and len(ex.choices) < 2:
        ex.warnings.append("multiple_choice usually needs at least 2 choices")
    if not ex.scenario:
        ex.warnings.append("Missing scenario")
    if not ex.concepts:
        ex.warnings.append("No concepts listed")
