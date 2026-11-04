"""Git Practice Lab API routes."""

from __future__ import annotations

from fastapi import APIRouter, Depends, File, HTTPException, UploadFile
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import get_settings
from app.database.session import get_app_db
from app.schemas.git_schemas import (
    GitAttemptRequest,
    GitAttemptResponse,
    GitExecuteRequest,
    GitExecuteResponse,
    GitHintResponse,
    GitImportConfirmRequest,
    GitImportConfirmResult,
    GitImportHistoryItem,
    GitImportPreview,
    GitProgressOut,
    GitQuestionDetail,
    GitQuestionSummary,
    GitResetResponse,
    GitSelectRequest,
    GitTopicOut,
)
from app.services.git_import_service import GitImportService
from app.services.git_lab_service import GitLabService

git_router = APIRouter(prefix="/api/git", tags=["git-lab"])
settings = get_settings()


def _user_id() -> int:
    return settings.default_user_id


@git_router.get("/topics", response_model=list[GitTopicOut])
async def list_topics(db: AsyncSession = Depends(get_app_db)):
    service = GitLabService(db)
    return await service.list_topics(_user_id())


@git_router.get("/questions", response_model=list[GitQuestionSummary])
async def list_questions(
    topic: str | None = None,
    difficulty: str | None = None,
    status: str | None = None,
    search: str | None = None,
    exercise_type: str | None = None,
    tag: str | None = None,
    db: AsyncSession = Depends(get_app_db),
):
    service = GitLabService(db)
    return await service.list_questions(
        _user_id(),
        topic=topic,
        difficulty=difficulty,
        status=status,
        search=search,
        exercise_type=exercise_type,
        tag=tag,
    )


@git_router.post("/select", response_model=GitQuestionSummary | None)
async def select_question(body: GitSelectRequest, db: AsyncSession = Depends(get_app_db)):
    service = GitLabService(db)
    return await service.select_question(
        _user_id(),
        strategy=body.strategy,
        topic=body.topic,
        difficulty=body.difficulty,
        after_id=body.after_id,
    )


@git_router.get("/questions/{question_id}", response_model=GitQuestionDetail)
async def get_question(question_id: int, db: AsyncSession = Depends(get_app_db)):
    service = GitLabService(db)
    detail = await service.get_question(_user_id(), question_id)
    if not detail:
        raise HTTPException(status_code=404, detail="Git question not found")
    return detail


@git_router.post("/execute", response_model=GitExecuteResponse)
async def execute_command(body: GitExecuteRequest, db: AsyncSession = Depends(get_app_db)):
    if not body.question_id:
        raise HTTPException(status_code=400, detail="question_id is required")
    service = GitLabService(db)
    try:
        return await service.execute(
            _user_id(), body.question_id, body.command, reset=body.reset
        )
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc


@git_router.post("/attempt", response_model=GitAttemptResponse)
async def submit_attempt(body: GitAttemptRequest, db: AsyncSession = Depends(get_app_db)):
    service = GitLabService(db)
    try:
        return await service.attempt(
            _user_id(), body.question_id, body.command, hint_index=body.hint_index
        )
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc


@git_router.post("/questions/{question_id}/hint", response_model=GitHintResponse)
async def request_hint(question_id: int, db: AsyncSession = Depends(get_app_db)):
    service = GitLabService(db)
    try:
        return await service.hint(_user_id(), question_id)
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc


@git_router.post("/questions/{question_id}/reset", response_model=GitResetResponse)
async def reset_scenario(question_id: int, db: AsyncSession = Depends(get_app_db)):
    service = GitLabService(db)
    q = await service._get_question(question_id)
    if not q:
        raise HTTPException(status_code=404, detail="Git question not found")
    state = service.reset_session(_user_id(), q)
    return {"ok": True, "state": state, "message": "Repository reset to the scenario start."}


@git_router.get("/progress", response_model=GitProgressOut)
async def git_progress(db: AsyncSession = Depends(get_app_db)):
    service = GitLabService(db)
    return await service.progress(_user_id())


# ------------------------------------------------------------------
# Markdown question-bank import
# ------------------------------------------------------------------


@git_router.post("/import/preview", response_model=GitImportPreview)
async def import_preview(
    file: UploadFile = File(...),
    db: AsyncSession = Depends(get_app_db),
):
    if not file.filename or not file.filename.lower().endswith((".md", ".markdown", ".txt")):
        raise HTTPException(status_code=400, detail="Upload a .md Markdown file")
    raw = await file.read()
    try:
        text = raw.decode("utf-8")
    except UnicodeDecodeError as exc:
        raise HTTPException(status_code=400, detail="File must be UTF-8 text") from exc

    service = GitImportService(db)
    preview = service.preview_markdown(text, file.filename)
    preview = await service.enrich_preview_with_db(preview)
    return preview


@git_router.post("/import/confirm", response_model=GitImportConfirmResult)
async def import_confirm(
    body: GitImportConfirmRequest,
    db: AsyncSession = Depends(get_app_db),
):
    service = GitImportService(db)
    try:
        return await service.confirm_import(
            body.preview_id,
            _user_id(),
            skip_duplicates=body.skip_duplicates,
            import_valid_only=body.import_valid_only,
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@git_router.get("/import/history", response_model=list[GitImportHistoryItem])
async def import_history(db: AsyncSession = Depends(get_app_db)):
    service = GitImportService(db)
    return await service.list_imports()
