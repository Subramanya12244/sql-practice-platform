"""Database schema introspection for the practice (Northwind) database."""

from __future__ import annotations

import re
from typing import List, Optional

import asyncpg

from app.config import get_settings
from app.schemas import ColumnInfo, SchemaResponse, TableSchema
from app.services.query_executor import _database_url_to_dsn

# Canonical Northwind-style table list
KNOWN_TABLES = [
    "customers",
    "employees",
    "suppliers",
    "products",
    "categories",
    "orders",
    "order_details",
    "shippers",
]


def normalize_table_names(raw: Optional[List[str]]) -> List[str]:
    """Split space/comma-joined table hints into clean identifiers."""
    if not raw:
        return []
    out: List[str] = []
    for item in raw:
        if not item:
            continue
        for part in re.split(r"[\s,;/|]+", str(item).strip()):
            name = part.strip().strip("`\"'").lower()
            if not name or not re.match(r"^[a-z_][a-z0-9_]*$", name):
                continue
            if name not in out:
                out.append(name)
    return out


class SchemaService:
    def __init__(self, database_url: Optional[str] = None) -> None:
        self.settings = get_settings()
        self.database_url = database_url or self.settings.database_url
        self.is_northwind = self.database_url == self.settings.database_url

    async def get_schema(
        self, table_names: Optional[List[str]] = None
    ) -> SchemaResponse:
        dsn = _database_url_to_dsn(self.database_url)
        cleaned = normalize_table_names(table_names)
        # Project databases have arbitrary tables, so discover them instead.
        tables_filter = cleaned or (
            KNOWN_TABLES if self.is_northwind else await self._list_tables(dsn)
        )

        conn = await asyncpg.connect(dsn, timeout=10)
        try:
            rows = await conn.fetch(
                """
                SELECT
                    c.table_name,
                    c.column_name,
                    c.data_type,
                    c.is_nullable
                FROM information_schema.columns c
                WHERE c.table_schema = 'public'
                  AND c.table_name = ANY($1::text[])
                ORDER BY c.table_name, c.ordinal_position
                """,
                tables_filter,
            )

            by_table: dict[str, list[ColumnInfo]] = {t: [] for t in tables_filter}
            for row in rows:
                tname = row["table_name"]
                if tname not in by_table:
                    by_table[tname] = []
                by_table[tname].append(
                    ColumnInfo(
                        name=row["column_name"],
                        data_type=row["data_type"],
                        is_nullable=row["is_nullable"] == "YES",
                    )
                )

            tables = [
                TableSchema(table_name=name, columns=cols)
                for name, cols in by_table.items()
                if cols
            ]
            return SchemaResponse(tables=tables)
        finally:
            await conn.close()

    async def _list_tables(self, dsn: str) -> List[str]:
        conn = await asyncpg.connect(dsn, timeout=10)
        try:
            rows = await conn.fetch(
                "SELECT table_name FROM information_schema.tables "
                "WHERE table_schema = 'public' AND table_type = 'BASE TABLE' "
                "ORDER BY table_name"
            )
            return [r["table_name"] for r in rows]
        finally:
            await conn.close()
