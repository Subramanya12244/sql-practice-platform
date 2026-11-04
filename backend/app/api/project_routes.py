"""Routes for SQL projects: dataset upload, schema inspection, execution."""

from __future__ import annotations

import shutil
import tempfile
from pathlib import Path
from typing import List, Optional

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import get_settings
from app.database.session import get_app_db
from app.models import Project, ProjectTable, Question
from app.schemas.project_schemas import (
    ProjectCreateResponse,
    ProjectDeleteResponse,
    ProjectDetail,
    ProjectListResponse,
    ProjectSummary,
    ProjectTableInfo,
    ValidateSolutionRequest,
    ValidateSolutionResponse,
)
from app.services.dataset_inference import SUPPORTED_DUMP, SUPPORTED_TABULAR
from app.services.project_service import ProjectProvisionError, ProjectService
from app.services.query_executor import QueryExecutor

project_router = APIRouter(prefix="/api/projects", tags=["projects"])
settings = get_settings()

ALLOWED_SUFFIXES = SUPPORTED_TABULAR | SUPPORTED_DUMP


async def _resolve_database_url(
    db: AsyncSession, project_id: Optional[int]
) -> str:
    """Read-only connection URL for a project, or Northwind when unset."""
    if project_id is None:
        return settings.database_url
    service = ProjectService(db)
    project = await service.get_project(project_id)
    if not project:
        raise HTTPException(status_code=404, detail=f"Project {project_id} not found")
    if project.source_type == "builtin":
        return settings.database_url
    if project.status != "ready":
        raise HTTPException(
            status_code=409,
            detail=f"Project '{project.name}' is not ready (status: {project.status}).",
        )
    return service.readonly_url(project.database_name)


@project_router.get("", response_model=ProjectListResponse)
async def list_projects(db: AsyncSession = Depends(get_app_db)):
    service = ProjectService(db)
    projects = await service.list_projects()
    return ProjectListResponse(
        projects=[ProjectSummary.model_validate(p) for p in projects],
        total=len(projects),
    )


@project_router.get("/{project_id}", response_model=ProjectDetail)
async def get_project(project_id: int, db: AsyncSession = Depends(get_app_db)):
    service = ProjectService(db)
    project = await service.get_project(project_id)
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")

    tables = list(
        (
            await db.execute(
                select(ProjectTable)
                .where(ProjectTable.project_id == project.id)
                .order_by(ProjectTable.table_name)
            )
        )
        .scalars()
        .all()
    )
    question_count = (
        await db.execute(
            select(func.count(Question.id)).where(Question.project_id == project.id)
        )
    ).scalar_one()

    detail = ProjectDetail.model_validate(project)
    detail.tables = [
        ProjectTableInfo(
            table_name=t.table_name,
            source_file=t.source_file,
            row_count=t.row_count,
            source_row_count=t.source_row_count,
            columns=t.columns or [],
            primary_key=t.primary_key or [],
            foreign_keys=t.foreign_keys or [],
        )
        for t in tables
    ]
    detail.question_count = question_count
    return detail


@project_router.post("", response_model=ProjectCreateResponse, status_code=201)
async def create_project_from_upload(
    name: str = Form(...),
    description: str = Form(""),
    files: List[UploadFile] = File(...),
    db: AsyncSession = Depends(get_app_db),
):
    """Upload datasets and provision a project database from them.

    Files are staged in a temp directory, analysed, then copied into the
    project folder only once provisioning succeeds.
    """
    if not files:
        raise HTTPException(status_code=400, detail="Upload at least one file.")

    max_bytes = settings.max_upload_mb * 1024 * 1024
    staged: List[Path] = []
    tmp_dir = Path(tempfile.mkdtemp(prefix="sqlp-upload-"))
    try:
        total = 0
        for upload in files:
            suffix = Path(upload.filename or "").suffix.lower()
            if suffix not in ALLOWED_SUFFIXES:
                raise HTTPException(
                    status_code=400,
                    detail=(
                        f"Unsupported file '{upload.filename}'. "
                        f"Allowed: {', '.join(sorted(ALLOWED_SUFFIXES))}"
                    ),
                )
            dest = tmp_dir / Path(upload.filename or "upload").name
            content = await upload.read()
            total += len(content)
            if total > max_bytes:
                raise HTTPException(
                    status_code=413,
                    detail=f"Upload exceeds {settings.max_upload_mb} MB.",
                )
            dest.write_bytes(content)
            staged.append(dest)

        service = ProjectService(db)
        try:
            result = await service.create_from_upload(
                name=name.strip(), description=description.strip(), saved_files=staged
            )
        except ProjectProvisionError as e:
            raise HTTPException(status_code=400, detail=str(e)) from e

        project = result["project"]
        data_dir = Path(project.folder_path) / "data"
        for path in staged:
            shutil.copy2(path, data_dir / path.name)

        warnings = result["warnings"]
        message = (
            f"Created '{project.name}' with {project.table_count} tables and "
            f"{project.row_count} rows in database {project.database_name}."
        )
        if warnings:
            message += f" {len(warnings)} warning(s) — review before practising."

        return ProjectCreateResponse(
            success=True,
            message=message,
            project=ProjectSummary.model_validate(project),
            tables=[ProjectTableInfo(**t) for t in result["tables"]],
            schema_sql=result["schema_sql"],
            er_diagram=result["er_diagram"],
            warnings=warnings,
        )
    finally:
        shutil.rmtree(tmp_dir, ignore_errors=True)


@project_router.delete("/{project_id}", response_model=ProjectDeleteResponse)
async def delete_project(
    project_id: int,
    drop_database: bool = True,
    db: AsyncSession = Depends(get_app_db),
):
    service = ProjectService(db)
    try:
        name = await service.delete_project(project_id, drop_database=drop_database)
    except ProjectProvisionError as e:
        raise HTTPException(status_code=400, detail=str(e)) from e
    return ProjectDeleteResponse(
        success=True,
        message=(
            f"Deleted project '{name}'"
            + (" and dropped its database." if drop_database else ".")
        ),
    )


@project_router.post("/validate-solution", response_model=ValidateSolutionResponse)
async def validate_solution(
    body: ValidateSolutionRequest, db: AsyncSession = Depends(get_app_db)
):
    """Run a pasted solution against a project so you can confirm it works."""
    url = await _resolve_database_url(db, body.project_id)
    result = await QueryExecutor(url).execute(body.sql, for_evaluation=True)
    return ValidateSolutionResponse(
        success=result.success,
        message=result.message or "",
        columns=result.columns,
        rows=result.rows,
        row_count=result.row_count or 0,
        execution_time_ms=result.execution_time_ms,
        truncated=result.truncated,
        error_type=result.error_type,
    )
