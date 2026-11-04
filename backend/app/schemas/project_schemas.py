"""Schemas for SQL projects and dataset uploads."""

from __future__ import annotations

from datetime import datetime
from typing import Any, List, Optional

from pydantic import BaseModel


class ProjectColumn(BaseModel):
    name: str
    original_name: str
    pg_type: str
    nullable: bool
    inferred_from: str
    sample: Optional[str] = None
    distinct_count: int = 0
    null_count: int = 0


class ProjectForeignKey(BaseModel):
    column: str
    references_table: str
    references_column: str
    confidence: str
    reason: str


class ProjectTableInfo(BaseModel):
    table_name: str
    source_file: Optional[str] = None
    row_count: int = 0
    source_row_count: int = 0
    imported_rows: Optional[int] = None
    row_count_matches: Optional[bool] = None
    columns: List[ProjectColumn] = []
    primary_key: List[str] = []
    foreign_keys: List[ProjectForeignKey] = []


class ProjectSummary(BaseModel):
    id: int
    name: str
    slug: str
    description: str = ""
    database_name: str
    source_type: str
    status: str
    table_count: int = 0
    row_count: int = 0
    is_default: bool = False
    error_message: Optional[str] = None
    created_at: Optional[datetime] = None

    model_config = {"from_attributes": True}


class ProjectDetail(ProjectSummary):
    folder_path: Optional[str] = None
    er_diagram: Optional[str] = None
    tables: List[ProjectTableInfo] = []
    question_count: int = 0


class ProjectListResponse(BaseModel):
    projects: List[ProjectSummary]
    total: int


class ProjectCreateResponse(BaseModel):
    success: bool
    message: str
    project: ProjectSummary
    tables: List[ProjectTableInfo] = []
    schema_sql: str = ""
    er_diagram: str = ""
    warnings: List[str] = []


class ProjectDeleteResponse(BaseModel):
    success: bool
    message: str


class ValidateSolutionRequest(BaseModel):
    """Run a pasted solution and capture what it returns."""

    sql: str
    project_id: Optional[int] = None


class ValidateSolutionResponse(BaseModel):
    success: bool
    message: str
    columns: List[str] = []
    rows: List[List[Any]] = []
    row_count: int = 0
    execution_time_ms: Optional[float] = None
    truncated: bool = False
    error_type: Optional[str] = None
