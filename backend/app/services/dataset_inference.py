"""Infer a PostgreSQL schema from uploaded tabular files.

Reads CSV / XLSX / JSON into DataFrames, maps pandas dtypes to PostgreSQL
types, then guesses primary keys and foreign keys across the whole upload.
Everything here is pure analysis — no database is touched.
"""

from __future__ import annotations

import json
import re
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

import pandas as pd

# Identifiers we generate ourselves, so keep them conservative.
_IDENT_RE = re.compile(r"[^a-z0-9_]+")
_RESERVED = {
    "all", "analyse", "analyze", "and", "any", "array", "as", "asc", "authorization",
    "binary", "both", "case", "cast", "check", "collate", "column", "constraint",
    "create", "cross", "current_date", "current_time", "current_timestamp",
    "current_user", "default", "deferrable", "desc", "distinct", "do", "else", "end",
    "except", "false", "for", "foreign", "freeze", "from", "full", "grant", "group",
    "having", "ilike", "in", "initially", "inner", "intersect", "into", "is", "isnull",
    "join", "leading", "left", "like", "limit", "localtime", "localtimestamp",
    "natural", "not", "notnull", "null", "offset", "on", "only", "or", "order",
    "outer", "overlaps", "placing", "primary", "references", "returning", "right",
    "select", "session_user", "similar", "some", "table", "then", "to", "trailing",
    "true", "union", "unique", "user", "using", "verbose", "when", "where", "window",
    "with",
}

SUPPORTED_TABULAR = {".csv", ".tsv", ".txt", ".xlsx", ".xls", ".json"}
SUPPORTED_DUMP = {".sql"}


def sanitize_identifier(raw: str, *, fallback: str = "col") -> str:
    """Turn an arbitrary header/filename into a safe lowercase identifier."""
    name = _IDENT_RE.sub("_", str(raw).strip().lower()).strip("_")
    name = re.sub(r"_+", "_", name)
    if not name:
        name = fallback
    if name[0].isdigit():
        name = f"{fallback}_{name}"
    if name in _RESERVED:
        name = f"{name}_col"
    return name[:63]


@dataclass
class ColumnSpec:
    name: str
    original_name: str
    pg_type: str
    nullable: bool
    inferred_from: str
    sample: Optional[str] = None
    distinct_count: int = 0
    null_count: int = 0

    def to_dict(self) -> Dict[str, Any]:
        return {
            "name": self.name,
            "original_name": self.original_name,
            "pg_type": self.pg_type,
            "nullable": self.nullable,
            "inferred_from": self.inferred_from,
            "sample": self.sample,
            "distinct_count": self.distinct_count,
            "null_count": self.null_count,
        }


@dataclass
class ForeignKeySpec:
    column: str
    references_table: str
    references_column: str
    confidence: str  # high | medium
    reason: str

    def to_dict(self) -> Dict[str, Any]:
        return {
            "column": self.column,
            "references_table": self.references_table,
            "references_column": self.references_column,
            "confidence": self.confidence,
            "reason": self.reason,
        }


@dataclass
class TableSpec:
    table_name: str
    source_file: str
    columns: List[ColumnSpec]
    row_count: int
    primary_key: List[str] = field(default_factory=list)
    foreign_keys: List[ForeignKeySpec] = field(default_factory=list)
    frame: Optional[pd.DataFrame] = None

    def to_dict(self) -> Dict[str, Any]:
        return {
            "table_name": self.table_name,
            "source_file": self.source_file,
            "row_count": self.row_count,
            "columns": [c.to_dict() for c in self.columns],
            "primary_key": self.primary_key,
            "foreign_keys": [fk.to_dict() for fk in self.foreign_keys],
        }


# ---------------------------------------------------------------------------
# Reading
# ---------------------------------------------------------------------------


def read_file(path: Path) -> List[Tuple[str, pd.DataFrame]]:
    """Read one uploaded file into (table_name, DataFrame) pairs.

    XLSX yields one entry per sheet; everything else yields a single entry.
    """
    suffix = path.suffix.lower()
    stem = sanitize_identifier(path.stem, fallback="table")

    if suffix in {".csv", ".txt"}:
        return [(stem, pd.read_csv(path, sep=None, engine="python"))]
    if suffix == ".tsv":
        return [(stem, pd.read_csv(path, sep="\t"))]
    if suffix in {".xlsx", ".xls"}:
        sheets = pd.read_excel(path, sheet_name=None)
        if len(sheets) == 1:
            only = next(iter(sheets.values()))
            return [(stem, only)]
        return [
            (sanitize_identifier(f"{stem}_{name}", fallback="table"), frame)
            for name, frame in sheets.items()
        ]
    if suffix == ".json":
        payload = json.loads(path.read_text(encoding="utf-8"))
        if isinstance(payload, list):
            return [(stem, pd.json_normalize(payload))]
        if isinstance(payload, dict):
            # {"customers": [...], "orders": [...]} -> one table per key
            table_like = {
                k: v
                for k, v in payload.items()
                if isinstance(v, list) and v and isinstance(v[0], dict)
            }
            if table_like:
                return [
                    (sanitize_identifier(k, fallback="table"), pd.json_normalize(v))
                    for k, v in table_like.items()
                ]
            return [(stem, pd.json_normalize([payload]))]
    raise ValueError(f"Unsupported file type: {path.name}")


# ---------------------------------------------------------------------------
# Type inference
# ---------------------------------------------------------------------------


def _looks_like_datetime(series: pd.Series) -> bool:
    sample = series.dropna().astype(str).head(50)
    if sample.empty:
        return False
    try:
        parsed = pd.to_datetime(sample, errors="coerce", format="mixed")
    except (ValueError, TypeError):
        return False
    return parsed.notna().mean() > 0.9


def _numeric_pg_type(series: pd.Series) -> str:
    non_null = series.dropna()
    if non_null.empty:
        return "INTEGER"
    if pd.api.types.is_integer_dtype(series) or (non_null % 1 == 0).all():
        biggest = non_null.abs().max()
        return "INTEGER" if biggest < 2_147_483_647 else "BIGINT"
    return "NUMERIC"


def infer_column(name: str, series: pd.Series) -> ColumnSpec:
    original = str(name)
    safe = sanitize_identifier(original, fallback="col")
    non_null = series.dropna()
    null_count = int(series.isna().sum())
    distinct = int(non_null.nunique()) if not non_null.empty else 0
    sample = str(non_null.iloc[0])[:80] if not non_null.empty else None

    if pd.api.types.is_bool_dtype(series):
        pg_type, source = "BOOLEAN", "bool dtype"
    elif pd.api.types.is_datetime64_any_dtype(series):
        pg_type, source = "TIMESTAMP", "datetime dtype"
    elif pd.api.types.is_numeric_dtype(series):
        pg_type, source = _numeric_pg_type(series), "numeric dtype"
    else:
        coerced = pd.to_numeric(non_null, errors="coerce")
        if not non_null.empty and coerced.notna().mean() > 0.98:
            pg_type, source = _numeric_pg_type(coerced), "numeric strings"
        elif _looks_like_datetime(series):
            pg_type, source = "TIMESTAMP", "parsed dates"
        else:
            lowered = set(non_null.astype(str).str.strip().str.lower().unique()[:5])
            if lowered and lowered <= {"true", "false", "yes", "no", "0", "1", "y", "n"}:
                pg_type, source = "BOOLEAN", "boolean-like values"
            else:
                max_len = int(non_null.astype(str).str.len().max()) if not non_null.empty else 0
                if max_len > 255:
                    pg_type, source = "TEXT", "long strings"
                else:
                    width = max(max_len * 2, 32)
                    pg_type, source = f"VARCHAR({min(width, 512)})", "text"

    return ColumnSpec(
        name=safe,
        original_name=original,
        pg_type=pg_type,
        nullable=null_count > 0,
        inferred_from=source,
        sample=sample,
        distinct_count=distinct,
        null_count=null_count,
    )


def _dedupe_column_names(columns: List[ColumnSpec]) -> None:
    seen: Dict[str, int] = {}
    for col in columns:
        if col.name in seen:
            seen[col.name] += 1
            col.name = f"{col.name}_{seen[col.name]}"[:63]
        else:
            seen[col.name] = 0


# ---------------------------------------------------------------------------
# Key detection
# ---------------------------------------------------------------------------


def detect_primary_key(
    frame: pd.DataFrame, columns: List[ColumnSpec], table_name: str
) -> List[str]:
    """Pick the most plausible single-column primary key.

    A candidate must be unique and non-null across every row; name-based hints
    break ties so `customer_id` wins over an incidentally-unique `email`.
    """
    if frame.empty:
        return []

    by_safe = {c.name: c for c in columns}
    candidates: List[Tuple[int, str]] = []
    for col, spec in zip(frame.columns, columns):
        series = frame[col]
        if series.isna().any() or series.nunique(dropna=False) != len(series):
            continue
        if spec.pg_type.startswith("VARCHAR") and spec.distinct_count > 0:
            pass
        name = spec.name
        if name == "id" or name == f"{table_name}_id":
            score = 0
        elif name == f"{table_name.rstrip('s')}_id":
            score = 1
        elif name.endswith("_id") or name.endswith("_key") or name.endswith("_code"):
            score = 2
        elif "id" in name:
            score = 3
        else:
            score = 4
        candidates.append((score, name))

    if not candidates:
        return []
    candidates.sort()
    best_score, best_name = candidates[0]
    # An arbitrary unique text column is a weak PK; only accept name-hinted ones.
    if best_score == 4 and by_safe[best_name].pg_type.startswith(("VARCHAR", "TEXT")):
        return []
    return [best_name]


def detect_foreign_keys(tables: List[TableSpec]) -> None:
    """Attach foreign keys by matching column names to other tables' primary keys.

    A name match alone is only a hint, so values are checked to be a subset of
    the referenced key before the FK is reported as high confidence.
    """
    pk_index: Dict[str, Tuple[str, str]] = {}
    for table in tables:
        if len(table.primary_key) == 1:
            pk_index[table.primary_key[0]] = (table.table_name, table.primary_key[0])

    frames = {t.table_name: t.frame for t in tables}
    col_maps = {
        t.table_name: {c.name: c.original_name for c in t.columns} for t in tables
    }

    for table in tables:
        for col in table.columns:
            target = pk_index.get(col.name)
            if not target:
                continue
            ref_table, ref_col = target
            if ref_table == table.table_name:
                continue

            confidence, reason = "medium", "column name matches primary key"
            child_frame = frames.get(table.table_name)
            parent_frame = frames.get(ref_table)
            if child_frame is not None and parent_frame is not None:
                child_orig = col_maps[table.table_name][col.name]
                parent_orig = col_maps[ref_table][ref_col]
                child_values = set(child_frame[child_orig].dropna().unique().tolist())
                parent_values = set(parent_frame[parent_orig].dropna().unique().tolist())
                if child_values and child_values <= parent_values:
                    confidence = "high"
                    reason = "all values exist in the referenced key"
                elif child_values:
                    orphans = len(child_values - parent_values)
                    reason = f"{orphans} values missing from {ref_table}.{ref_col}"
                    continue

            table.foreign_keys.append(
                ForeignKeySpec(
                    column=col.name,
                    references_table=ref_table,
                    references_column=ref_col,
                    confidence=confidence,
                    reason=reason,
                )
            )


# ---------------------------------------------------------------------------
# Entry point
# ---------------------------------------------------------------------------


def analyze_files(paths: List[Path]) -> List[TableSpec]:
    """Read every uploaded file and infer a complete relational schema."""
    tables: List[TableSpec] = []
    used_names: set[str] = set()

    for path in paths:
        if path.suffix.lower() in SUPPORTED_DUMP:
            continue
        for table_name, frame in read_file(path):
            frame = frame.dropna(axis=1, how="all")
            name = table_name
            suffix = 2
            while name in used_names:
                name = f"{table_name}_{suffix}"
                suffix += 1
            used_names.add(name)

            columns = [infer_column(c, frame[c]) for c in frame.columns]
            _dedupe_column_names(columns)
            spec = TableSpec(
                table_name=name,
                source_file=path.name,
                columns=columns,
                row_count=int(len(frame)),
                frame=frame,
            )
            spec.primary_key = detect_primary_key(frame, columns, name)
            tables.append(spec)

    detect_foreign_keys(tables)
    return tables


# ---------------------------------------------------------------------------
# DDL + diagram generation
# ---------------------------------------------------------------------------


def generate_create_table(table: TableSpec) -> str:
    lines = [f'CREATE TABLE "{table.table_name}" (']
    parts: List[str] = []
    for col in table.columns:
        null_clause = "" if col.nullable else " NOT NULL"
        parts.append(f'    "{col.name}" {col.pg_type}{null_clause}')
    if table.primary_key:
        cols = ", ".join(f'"{c}"' for c in table.primary_key)
        parts.append(f"    PRIMARY KEY ({cols})")
    lines.append(",\n".join(parts))
    lines.append(");")
    return "\n".join(lines)


def generate_foreign_key_ddl(table: TableSpec) -> List[str]:
    statements = []
    for fk in table.foreign_keys:
        if fk.confidence != "high":
            continue
        statements.append(
            f'ALTER TABLE "{table.table_name}" '
            f'ADD CONSTRAINT "fk_{table.table_name}_{fk.column}" '
            f'FOREIGN KEY ("{fk.column}") '
            f'REFERENCES "{fk.references_table}" ("{fk.references_column}");'
        )
    return statements


def generate_schema_sql(tables: List[TableSpec]) -> str:
    blocks = [
        "-- Generated by DataForge from uploaded files.",
        "-- Review before relying on it: types and keys are inferred.",
        "",
    ]
    for table in tables:
        blocks.append(generate_create_table(table))
        blocks.append("")
    for table in tables:
        for stmt in generate_foreign_key_ddl(table):
            blocks.append(stmt)
    return "\n".join(blocks) + "\n"


def generate_er_diagram(tables: List[TableSpec]) -> str:
    """Mermaid erDiagram source, rendered client-side."""
    lines = ["erDiagram"]
    for table in tables:
        lines.append(f"    {table.table_name} {{")
        for col in table.columns:
            base_type = col.pg_type.split("(")[0].lower()
            marker = ""
            if col.name in table.primary_key:
                marker = " PK"
            elif any(fk.column == col.name for fk in table.foreign_keys):
                marker = " FK"
            lines.append(f"        {base_type} {col.name}{marker}")
        lines.append("    }")
    for table in tables:
        for fk in table.foreign_keys:
            lines.append(
                f"    {fk.references_table} ||--o{{ {table.table_name} : "
                f'"{fk.column}"'
            )
    return "\n".join(lines)
