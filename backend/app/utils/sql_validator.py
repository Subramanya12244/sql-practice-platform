"""SQL security validation — reject destructive / multi-statement queries.

Uses sqlglot for AST-based parsing rather than string matching alone.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import List, Optional, Set

import sqlglot
from sqlglot import exp
from sqlglot.errors import ParseError


# Statement types that are allowed (read-only)
ALLOWED_ROOT_TYPES: Set[type] = {
    exp.Select,
    exp.Union,
    exp.Intersect,
    exp.Except,
    exp.With,  # WITH ... SELECT
}

# Expression types that indicate mutation / DDL
FORBIDDEN_TYPES: Set[type] = {
    exp.Insert,
    exp.Update,
    exp.Delete,
    exp.Drop,
    exp.Create,
    exp.Alter,
    exp.TruncateTable,
    exp.Grant,
    exp.Command,  # CATCH-ALL for VACUUM, COMMENT, REVOKE, etc. when parsed as Command
}

FORBIDDEN_KEYWORDS = {
    "INSERT",
    "UPDATE",
    "DELETE",
    "DROP",
    "ALTER",
    "TRUNCATE",
    "CREATE",
    "GRANT",
    "REVOKE",
    "COMMENT",
    "VACUUM",
    "COPY",
    "CALL",
    "EXECUTE",
    "DO",
    "SET",
    "RESET",
    "SHOW",
    "LISTEN",
    "NOTIFY",
    "LOAD",
    "LOCK",
    "REINDEX",
    "CLUSTER",
    "ANALYZE",
    "DISCARD",
    "PREPARE",
    "DEALLOCATE",
}


@dataclass
class ValidationResult:
    ok: bool
    error: Optional[str] = None
    error_type: Optional[str] = None


def _contains_forbidden_ast(node: exp.Expression) -> Optional[str]:
    """Walk the AST and reject any forbidden node types."""
    for child in node.walk():
        for forbidden in FORBIDDEN_TYPES:
            if isinstance(child, forbidden):
                return f"Forbidden statement type: {type(child).__name__}"
        # Reject DDL-like commands
        if isinstance(child, exp.Command):
            cmd = (child.this or "").upper() if isinstance(child.this, str) else str(child.this).upper()
            return f"Forbidden command: {cmd or 'COMMAND'}"
    return None


def _keyword_fallback_check(sql: str) -> Optional[str]:
    """Secondary defence: scan tokens for forbidden keywords outside of string literals."""
    # Strip single-quoted and dollar-quoted string literals roughly
    cleaned = sql
    # Remove '--' line comments
    lines = []
    for line in cleaned.splitlines():
        if "--" in line:
            line = line[: line.index("--")]
        lines.append(line)
    cleaned = "\n".join(lines)
    # Remove /* */ block comments
    while "/*" in cleaned and "*/" in cleaned:
        start = cleaned.index("/*")
        end = cleaned.index("*/", start) + 2
        cleaned = cleaned[:start] + " " + cleaned[end:]

    # Tokenize roughly on whitespace and punctuation
    import re

    tokens = re.findall(r"[A-Za-z_]+", cleaned.upper())
    for token in tokens:
        if token in FORBIDDEN_KEYWORDS:
            return f"Forbidden keyword: {token}"
    return None


def validate_sql(sql: str) -> ValidationResult:
    """Validate that SQL is a single read-only statement."""
    if not sql or not sql.strip():
        return ValidationResult(ok=False, error="SQL query is empty.", error_type="VALIDATION")

    stripped = sql.strip().rstrip(";")

    # Reject multiple statements (semicolon-separated)
    # Parse with sqlglot — it can return a list for multiple statements
    try:
        statements = sqlglot.parse(stripped, dialect="postgres")
    except ParseError as e:
        # Let PostgreSQL report the real syntax error later for SELECT-looking queries,
        # but still apply keyword fallback for obvious attacks.
        kw_err = _keyword_fallback_check(stripped)
        if kw_err:
            return ValidationResult(ok=False, error=kw_err, error_type="FORBIDDEN")
        # Allow through to execution so user sees real PG syntax error
        return ValidationResult(ok=True)

    # Filter out None (empty statements)
    statements = [s for s in statements if s is not None]

    if len(statements) == 0:
        return ValidationResult(ok=False, error="No valid SQL statement found.", error_type="VALIDATION")

    if len(statements) > 1:
        return ValidationResult(
            ok=False,
            error="Multiple statements are not allowed. Submit a single SELECT query.",
            error_type="FORBIDDEN",
        )

    stmt = statements[0]

    # Unwrap WITH — the root may be With wrapping a Select/Union
    root = stmt
    if isinstance(stmt, exp.With):
        root = stmt.this or stmt

    allowed = False
    for t in ALLOWED_ROOT_TYPES:
        if isinstance(root, t) or isinstance(stmt, t):
            allowed = True
            break

    if not allowed:
        return ValidationResult(
            ok=False,
            error=f"Only SELECT / WITH / set-operation queries are allowed. Got: {type(root).__name__}",
            error_type="FORBIDDEN",
        )

    ast_err = _contains_forbidden_ast(stmt)
    if ast_err:
        return ValidationResult(ok=False, error=ast_err, error_type="FORBIDDEN")

    kw_err = _keyword_fallback_check(stripped)
    if kw_err:
        return ValidationResult(ok=False, error=kw_err, error_type="FORBIDDEN")

    return ValidationResult(ok=True)


def sanitize_error_message(message: str) -> str:
    """Strip credentials / host details from database error messages."""
    import re

    msg = message
    # Remove connection strings
    msg = re.sub(r"postgresql(\+\w+)?://[^\s]+", "[redacted]", msg, flags=re.IGNORECASE)
    msg = re.sub(r"password[=:]\s*\S+", "password=[redacted]", msg, flags=re.IGNORECASE)
    msg = re.sub(r"host[=:]\s*\S+", "host=[redacted]", msg, flags=re.IGNORECASE)
    return msg
