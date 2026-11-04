"""Provision and manage per-project PostgreSQL databases.

Each project gets its own database (`<prefix><slug>`), created from uploaded
files. The owner role runs DDL and imports; the shared read-only role is
granted SELECT so the practice editor can query it safely.
"""

from __future__ import annotations

import decimal
import math
import re
from datetime import date, datetime
from pathlib import Path
from typing import Any, Dict, List, Optional, Sequence

import asyncpg
import pandas as pd
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import get_settings
from app.models import Project, ProjectTable
from app.services.dataset_inference import (
    SUPPORTED_DUMP,
    SUPPORTED_TABULAR,
    TableSpec,
    analyze_files,
    generate_create_table,
    generate_er_diagram,
    generate_foreign_key_ddl,
    generate_schema_sql,
    sanitize_identifier,
)

_DB_NAME_RE = re.compile(r"^[a-z_][a-z0-9_]*$")


def _dsn(url: str) -> str:
    """SQLAlchemy URL -> plain asyncpg DSN."""
    return url.replace("postgresql+asyncpg://", "postgresql://")


def _quote_ident(name: str) -> str:
    return '"' + name.replace('"', '""') + '"'


class ProjectProvisionError(RuntimeError):
    pass


class ProjectService:
    def __init__(self, db: AsyncSession) -> None:
        self.db = db
        self.settings = get_settings()

    # ------------------------------------------------------------------
    # Paths / naming
    # ------------------------------------------------------------------

    def projects_root(self) -> Path:
        raw = Path(self.settings.projects_root)
        if raw.is_absolute():
            root = raw
        else:
            root = (Path(__file__).resolve().parents[2] / raw).resolve()
        root.mkdir(parents=True, exist_ok=True)
        return root

    def database_name_for(self, slug: str) -> str:
        name = f"{self.settings.project_db_prefix}{slug}"[:63]
        if not _DB_NAME_RE.match(name):
            raise ProjectProvisionError(f"Cannot build a safe database name from '{slug}'.")
        return name

    def project_url(self, database_name: str) -> str:
        s = self.settings
        return (
            f"postgresql+asyncpg://{s.project_db_owner}:{s.project_db_owner_password}"
            f"@{s.project_db_host}:{s.project_db_port}/{database_name}"
        )

    def readonly_url(self, database_name: str) -> str:
        s = self.settings
        return (
            f"postgresql+asyncpg://{s.project_db_readonly_user}:"
            f"{s.project_db_readonly_password}"
            f"@{s.project_db_host}:{s.project_db_port}/{database_name}"
        )

    # ------------------------------------------------------------------
    # Database provisioning
    # ------------------------------------------------------------------

    async def _create_database(self, database_name: str) -> None:
        conn = await asyncpg.connect(_dsn(self.settings.postgres_admin_url))
        try:
            exists = await conn.fetchval(
                "SELECT 1 FROM pg_database WHERE datname = $1", database_name
            )
            if exists:
                raise ProjectProvisionError(
                    f"Database {database_name} already exists. "
                    "Pick a different project name or delete the old project."
                )
            # CREATE DATABASE cannot be parameterised; the name is validated above.
            await conn.execute(
                f"CREATE DATABASE {_quote_ident(database_name)} "
                f"OWNER {_quote_ident(self.settings.project_db_owner)}"
            )
        finally:
            await conn.close()

    async def _drop_database(self, database_name: str) -> None:
        conn = await asyncpg.connect(_dsn(self.settings.postgres_admin_url))
        try:
            await conn.execute(
                "SELECT pg_terminate_backend(pid) FROM pg_stat_activity "
                "WHERE datname = $1 AND pid <> pg_backend_pid()",
                database_name,
            )
            await conn.execute(f"DROP DATABASE IF EXISTS {_quote_ident(database_name)}")
        finally:
            await conn.close()

    async def _grant_readonly(self, conn: asyncpg.Connection, database_name: str) -> None:
        role = self.settings.project_db_readonly_user
        exists = await conn.fetchval(
            "SELECT 1 FROM pg_roles WHERE rolname = $1", role
        )
        if not exists:
            return
        quoted = _quote_ident(role)
        await conn.execute(
            f"GRANT CONNECT ON DATABASE {_quote_ident(database_name)} TO {quoted}"
        )
        await conn.execute(f"GRANT USAGE ON SCHEMA public TO {quoted}")
        await conn.execute(
            f"GRANT SELECT ON ALL TABLES IN SCHEMA public TO {quoted}"
        )
        await conn.execute(
            f"ALTER DEFAULT PRIVILEGES IN SCHEMA public "
            f"GRANT SELECT ON TABLES TO {quoted}"
        )

    # ------------------------------------------------------------------
    # Data conversion + loading
    # ------------------------------------------------------------------

    @staticmethod
    def _coerce(value: Any, pg_type: str) -> Any:
        if value is None:
            return None
        if isinstance(value, float) and math.isnan(value):
            return None
        if value is pd.NaT:
            return None
        try:
            if pd.isna(value):
                return None
        except (TypeError, ValueError):
            pass

        base = pg_type.split("(")[0].upper()
        if base in {"INTEGER", "BIGINT"}:
            return int(float(value))
        if base == "NUMERIC":
            return decimal.Decimal(str(value))
        if base == "BOOLEAN":
            if isinstance(value, str):
                return value.strip().lower() in {"true", "yes", "y", "1", "t"}
            return bool(value)
        if base == "TIMESTAMP":
            if isinstance(value, datetime):
                return value.replace(tzinfo=None)
            if isinstance(value, date):
                return datetime(value.year, value.month, value.day)
            parsed = pd.to_datetime(value, errors="coerce")
            return None if pd.isna(parsed) else parsed.to_pydatetime().replace(tzinfo=None)
        return str(value)

    def _records_for(self, table: TableSpec) -> List[Sequence[Any]]:
        frame = table.frame
        if frame is None:
            return []
        originals = [c.original_name for c in table.columns]
        types = [c.pg_type for c in table.columns]
        records: List[Sequence[Any]] = []
        for row in frame[originals].itertuples(index=False, name=None):
            records.append(
                tuple(self._coerce(v, t) for v, t in zip(row, types))
            )
        return records

    async def _load_tables(
        self, conn: asyncpg.Connection, tables: List[TableSpec]
    ) -> Dict[str, int]:
        loaded: Dict[str, int] = {}
        for table in tables:
            records = self._records_for(table)
            if records:
                await conn.copy_records_to_table(
                    table.table_name,
                    records=records,
                    columns=[c.name for c in table.columns],
                )
            count = await conn.fetchval(
                f"SELECT COUNT(*) FROM {_quote_ident(table.table_name)}"
            )
            loaded[table.table_name] = int(count)
        return loaded

    # ------------------------------------------------------------------
    # Public API
    # ------------------------------------------------------------------

    async def list_projects(self) -> List[Project]:
        result = await self.db.execute(select(Project).order_by(Project.created_at))
        return list(result.scalars().all())

    async def get_project(self, project_id: int) -> Optional[Project]:
        result = await self.db.execute(select(Project).where(Project.id == project_id))
        project = result.scalar_one_or_none()
        if project:
            return project
        result = await self.db.execute(select(Project).where(Project.slug == str(project_id)))
        return result.scalar_one_or_none()

    async def get_project_by_slug(self, slug: str) -> Optional[Project]:
        result = await self.db.execute(select(Project).where(Project.slug == slug))
        return result.scalar_one_or_none()

    async def create_from_upload(
        self,
        *,
        name: str,
        description: str,
        saved_files: List[Path],
    ) -> Dict[str, Any]:
        """Analyse uploaded files, provision a database, and import the data.

        Rolls the database back out if anything fails partway, so a failed
        upload never leaves a half-built project behind.
        """
        slug = sanitize_identifier(name, fallback="project")
        if await self.get_project_by_slug(slug):
            raise ProjectProvisionError(
                f"A project named '{name}' already exists (slug '{slug}')."
            )
        database_name = self.database_name_for(slug)

        tabular = [p for p in saved_files if p.suffix.lower() in SUPPORTED_TABULAR]
        dumps = [p for p in saved_files if p.suffix.lower() in SUPPORTED_DUMP]
        if not tabular and not dumps:
            raise ProjectProvisionError(
                "No supported files found. Upload CSV, TSV, XLSX, JSON or .sql files."
            )

        tables = analyze_files(tabular) if tabular else []
        if not tables and not dumps:
            raise ProjectProvisionError("Could not read any tables from the upload.")

        schema_sql = generate_schema_sql(tables) if tables else ""
        er_diagram = generate_er_diagram(tables) if tables else ""

        project_dir = self.projects_root() / slug
        (project_dir / "data").mkdir(parents=True, exist_ok=True)
        (project_dir / "questions").mkdir(parents=True, exist_ok=True)
        if schema_sql:
            (project_dir / "schema.sql").write_text(schema_sql, encoding="utf-8")
        if er_diagram:
            (project_dir / "er_diagram.mmd").write_text(er_diagram, encoding="utf-8")

        project = Project(
            name=name,
            slug=slug,
            description=description,
            database_name=database_name,
            source_type="upload",
            status="creating",
            folder_path=str(project_dir),
            er_diagram=er_diagram,
        )
        self.db.add(project)
        await self.db.flush()

        await self._create_database(database_name)
        warnings: List[str] = []
        try:
            conn = await asyncpg.connect(_dsn(self.project_url(database_name)))
            try:
                # Tables first, then rows, then constraints — adding foreign keys
                # up front would reject rows whose parent table is not loaded yet.
                for table in tables:
                    await conn.execute(generate_create_table(table))
                loaded = await self._load_tables(conn, tables)
                for dump in dumps:
                    try:
                        await conn.execute(dump.read_text(encoding="utf-8"))
                    except Exception as e:
                        warnings.append(f"{dump.name} failed to run: {e}")
                for table in tables:
                    for statement in generate_foreign_key_ddl(table):
                        try:
                            await conn.execute(statement)
                        except Exception as e:
                            warnings.append(
                                f"Skipped inferred foreign key on "
                                f"{table.table_name}: {e}"
                            )
                await self._grant_readonly(conn, database_name)
            finally:
                await conn.close()
        except Exception as e:
            await self._drop_database(database_name)
            await self.db.delete(project)
            await self.db.flush()
            raise ProjectProvisionError(f"Provisioning failed: {e}") from e

        total_rows = 0
        table_reports: List[Dict[str, Any]] = []
        for table in tables:
            imported = loaded.get(table.table_name, 0)
            total_rows += imported
            if imported != table.row_count:
                warnings.append(
                    f"{table.table_name}: read {table.row_count} rows from "
                    f"{table.source_file} but {imported} landed in the table."
                )
            self.db.add(
                ProjectTable(
                    project_id=project.id,
                    table_name=table.table_name,
                    source_file=table.source_file,
                    row_count=imported,
                    source_row_count=table.row_count,
                    columns=[c.to_dict() for c in table.columns],
                    primary_key=table.primary_key,
                    foreign_keys=[fk.to_dict() for fk in table.foreign_keys],
                )
            )
            table_reports.append(
                {
                    **table.to_dict(),
                    "imported_rows": imported,
                    "row_count_matches": imported == table.row_count,
                }
            )

        project.status = "ready"
        project.table_count = len(tables)
        project.row_count = total_rows
        await self.db.flush()

        return {
            "project": project,
            "tables": table_reports,
            "schema_sql": schema_sql,
            "er_diagram": er_diagram,
            "warnings": warnings,
        }

    async def delete_project(self, project_id: int, *, drop_database: bool = True) -> str:
        project = await self.get_project(project_id)
        if not project:
            raise ProjectProvisionError(f"Project {project_id} not found.")
        if project.source_type == "builtin":
            raise ProjectProvisionError("The built-in Northwind project cannot be deleted.")
        name = project.name
        if drop_database:
            await self._drop_database(project.database_name)
        await self.db.delete(project)
        await self.db.flush()
        return name


def _split_statements(sql: str) -> List[str]:
    """Split generated DDL on semicolons, ignoring comments and blanks."""
    statements: List[str] = []
    for chunk in sql.split(";"):
        cleaned = "\n".join(
            line for line in chunk.splitlines() if not line.strip().startswith("--")
        ).strip()
        if cleaned:
            statements.append(cleaned)
    return statements
