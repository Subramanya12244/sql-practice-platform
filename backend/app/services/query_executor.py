"""Safe SQL query execution against the practice (Northwind) database."""

from __future__ import annotations

import time
from dataclasses import dataclass, field
from datetime import date, datetime
from decimal import Decimal
from typing import Any, List, Optional

import asyncpg
from asyncpg.exceptions import (
    InsufficientPrivilegeError,
    PostgresSyntaxError,
    QueryCanceledError,
    UndefinedTableError,
)

from app.config import get_settings
from app.utils.sql_validator import sanitize_error_message, validate_sql


@dataclass
class QueryResult:
    success: bool
    execution_time_ms: Optional[float] = None
    row_count: Optional[int] = None
    columns: List[str] = field(default_factory=list)
    rows: List[List[Any]] = field(default_factory=list)
    error_type: Optional[str] = None
    message: Optional[str] = None
    truncated: bool = False


def _serialize_value(value: Any) -> Any:
    if value is None:
        return None
    if isinstance(value, Decimal):
        return float(value)
    if isinstance(value, (datetime, date)):
        return value.isoformat()
    if isinstance(value, bytes):
        return value.decode("utf-8", errors="replace")
    if isinstance(value, (list, tuple)):
        return [_serialize_value(v) for v in value]
    return value


def _database_url_to_dsn(url: str) -> str:
    """Convert SQLAlchemy async URL to asyncpg DSN."""
    # postgresql+asyncpg://user:pass@host:port/db -> postgresql://...
    dsn = url.replace("postgresql+asyncpg://", "postgresql://")
    dsn = dsn.replace("postgres+asyncpg://", "postgresql://")
    return dsn


class QueryExecutor:
    def __init__(self, database_url: Optional[str] = None) -> None:
        self.settings = get_settings()
        # Defaults to Northwind; project databases pass their own read-only URL.
        self.database_url = database_url or self.settings.database_url

    async def execute(self, sql: str, *, for_evaluation: bool = False) -> QueryResult:
        """Execute a validated read-only SQL query.

        When for_evaluation is True, max_rows limit is raised so result
        comparison is complete.
        """
        validation = validate_sql(sql)
        if not validation.ok:
            return QueryResult(
                success=False,
                error_type=validation.error_type or "FORBIDDEN",
                message=validation.error or "Query rejected.",
            )

        timeout = self.settings.query_timeout_seconds
        max_rows = (
            self.settings.query_max_rows * 10
            if for_evaluation
            else self.settings.query_max_rows
        )
        dsn = _database_url_to_dsn(self.database_url)

        conn: Optional[asyncpg.Connection] = None
        try:
            conn = await asyncpg.connect(dsn, timeout=10)
            # Enforce statement timeout at the session level
            await conn.execute(f"SET statement_timeout = '{int(timeout * 1000)}'")
            # Read-only transaction as defence in depth
            await conn.execute("SET default_transaction_read_only = on")
            await conn.execute("BEGIN READ ONLY")

            start = time.perf_counter()
            # Fetch one extra row to detect truncation
            records = await conn.fetch(sql.strip().rstrip(";"), timeout=timeout)
            elapsed_ms = (time.perf_counter() - start) * 1000

            await conn.execute("COMMIT")

            truncated = False
            if len(records) > max_rows:
                records = records[:max_rows]
                truncated = True

            columns: List[str] = []
            rows: List[List[Any]] = []
            if records:
                columns = list(records[0].keys())
                for rec in records:
                    rows.append([_serialize_value(rec[c]) for c in columns])

            return QueryResult(
                success=True,
                execution_time_ms=round(elapsed_ms, 2),
                row_count=len(rows),
                columns=columns,
                rows=rows,
                truncated=truncated,
                message="Query executed successfully"
                + (" (results truncated)" if truncated else ""),
            )

        except QueryCanceledError:
            return QueryResult(
                success=False,
                error_type="TIMEOUT",
                message="Query execution exceeded the allowed time.",
            )
        except InsufficientPrivilegeError:
            return QueryResult(
                success=False,
                error_type="PERMISSION",
                message="This operation is not permitted.",
            )
        except UndefinedTableError as e:
            return QueryResult(
                success=False,
                error_type="SQL_ERROR",
                message=sanitize_error_message(f'Relation does not exist. {e}'),
            )
        except PostgresSyntaxError as e:
            return QueryResult(
                success=False,
                error_type="SQL_ERROR",
                message=sanitize_error_message(f"SQL Error\n{e}"),
            )
        except asyncpg.PostgresError as e:
            return QueryResult(
                success=False,
                error_type="SQL_ERROR",
                message=sanitize_error_message(str(e)),
            )
        except TimeoutError:
            return QueryResult(
                success=False,
                error_type="TIMEOUT",
                message="Query execution exceeded the allowed time.",
            )
        except OSError as e:
            return QueryResult(
                success=False,
                error_type="CONNECTION",
                message=sanitize_error_message(
                    f"Could not connect to the practice database. {e}"
                ),
            )
        except Exception as e:
            return QueryResult(
                success=False,
                error_type="INTERNAL",
                message=sanitize_error_message(str(e)),
            )
        finally:
            if conn is not None and not conn.is_closed():
                try:
                    await conn.close()
                except Exception:
                    pass
