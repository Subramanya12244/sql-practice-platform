"""Import API routes — ChatGPT conversations.json processing.

POST /api/import/chatgpt/scan     — upload file, score conversations
POST /api/import/chatgpt/preview  — parse selected conversation, show preview
POST /api/import/chatgpt/confirm  — execute import
GET  /api/questions/{id}/imported-attempts
GET  /api/questions/{id}/feedback
GET  /api/questions/{id}/mistakes
GET  /api/mistakes
GET  /api/concepts
"""

from __future__ import annotations

import json
import tempfile
from pathlib import Path
from typing import Any, Dict, List, Optional

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile
from sqlalchemy.ext.asyncio import AsyncSession

from app.database.session import get_app_db
from app.schemas.import_schemas import (
    ConfirmImportRequest,
    ImportSummary,
    PreviewResponse,
    ScanResponse,
)
from app.services.import_service import ImportService

import_router = APIRouter(prefix="/api/import")
data_router = APIRouter(prefix="/api")

# ---------------------------------------------------------------------------
# In-memory session store for raw JSON between scan → preview → confirm
# (Simple dict is fine for a single-user local app; replace with Redis for
#  multi-user deployments)
# ---------------------------------------------------------------------------
_session_store: Dict[str, Any] = {}


# ---------------------------------------------------------------------------
# Step 1: Scan
# ---------------------------------------------------------------------------


@import_router.post("/chatgpt/scan", response_model=ScanResponse)
async def scan_chatgpt(
    file: UploadFile = File(...),
    db: AsyncSession = Depends(get_app_db),
):
    """Upload conversations.json and score conversations by SQL relevance."""
    if file.content_type not in ("application/json", "text/plain", None, ""):
        # browsers may send wrong content-type; just try to parse
        pass

    raw_bytes = await file.read()
    if len(raw_bytes) > 200 * 1024 * 1024:  # 200 MB hard limit
        raise HTTPException(413, "File too large (max 200 MB)")

    try:
        raw_data = json.loads(raw_bytes.decode("utf-8"))
    except json.JSONDecodeError as e:
        raise HTTPException(400, f"Invalid JSON: {e}") from e

    service = ImportService(db)
    result = service.scan(raw_data)

    # Store for subsequent steps — key by first conversation id
    key = result.conversations[0].conversation_id if result.conversations else "default"
    _session_store[key] = raw_data
    # Also store under a generic key for convenience
    _session_store["__latest__"] = raw_data

    return result


# ---------------------------------------------------------------------------
# Step 2: Preview
# ---------------------------------------------------------------------------


@import_router.post("/chatgpt/preview", response_model=PreviewResponse)
async def preview_chatgpt(
    conversation_id: str = Form(...),
    start_question: int = Form(59),
    file: Optional[UploadFile] = File(None),
    db: AsyncSession = Depends(get_app_db),
):
    """Parse a selected conversation and return a preview without saving."""
    raw_data = None

    # Try re-uploaded file first
    if file is not None:
        raw_bytes = await file.read()
        try:
            raw_data = json.loads(raw_bytes.decode("utf-8"))
            _session_store["__latest__"] = raw_data
        except json.JSONDecodeError as e:
            raise HTTPException(400, f"Invalid JSON: {e}") from e

    # Fall back to session
    if raw_data is None:
        raw_data = _session_store.get(conversation_id) or _session_store.get(
            "__latest__"
        )

    if raw_data is None:
        raise HTTPException(
            400,
            "No conversation data in session. Please upload the file again.",
        )

    service = ImportService(db)
    try:
        return await service.preview(raw_data, conversation_id, start_question)
    except ValueError as e:
        raise HTTPException(404, str(e)) from e


# ---------------------------------------------------------------------------
# Step 3: Confirm
# ---------------------------------------------------------------------------


@import_router.post("/chatgpt/confirm", response_model=ImportSummary)
async def confirm_chatgpt(
    body: ConfirmImportRequest,
    db: AsyncSession = Depends(get_app_db),
):
    """Execute the import, persisting questions/attempts/feedback."""
    raw_data = _session_store.get(
        body.conversation_id
    ) or _session_store.get("__latest__")

    if raw_data is None:
        raise HTTPException(
            400,
            "Conversation data not found in session. Please re-upload the file.",
        )

    service = ImportService(db)
    try:
        summary = await service.confirm(raw_data, body)
        return summary
    except Exception as e:
        raise HTTPException(500, f"Import failed: {e}") from e


# ---------------------------------------------------------------------------
# Per-question imported data
# ---------------------------------------------------------------------------


@data_router.get("/questions/{question_id}/imported-attempts")
async def get_imported_attempts(
    question_id: int, db: AsyncSession = Depends(get_app_db)
):
    from sqlalchemy import select
    from app.models import Question, ImportedAttempt, Feedback

    # Resolve by question_number first
    q_result = await db.execute(
        select(Question).where(Question.question_number == question_id)
    )
    question = q_result.scalar_one_or_none()
    if not question:
        question = await db.get(Question, question_id)
    if not question:
        raise HTTPException(404, "Question not found")

    service = ImportService(db)
    attempts = await service.get_imported_attempts(question.id)

    # Load feedbacks for each attempt
    result_list = []
    for att in attempts:
        fb_result = await db.execute(
            select(Feedback).where(
                Feedback.imported_attempt_id == att.id
            ).order_by(Feedback.created_at)
        )
        feedbacks = fb_result.scalars().all()

        from app.models import Mistake
        m_result = await db.execute(
            select(Mistake).where(
                Mistake.imported_attempt_id == att.id
            ).order_by(Mistake.created_at)
        )
        mistakes = m_result.scalars().all()

        result_list.append(
            {
                "id": att.id,
                "attempt_number": att.attempt_number,
                "sql": att.sql,
                "is_correct": att.is_correct,
                "score": att.score,
                "score_max": att.score_max,
                "score_text": att.score_text,
                "approach_notes": att.approach_notes,
                "source": "chatgpt",
                "created_at": att.created_at.isoformat() if att.created_at else None,
                "feedbacks": [
                    {
                        "feedback_type": f.feedback_type,
                        "feedback_text": f.feedback_text,
                    }
                    for f in feedbacks
                ],
                "mistakes": [
                    {
                        "category": m.category,
                        "description": m.description,
                        "correction": m.correction,
                    }
                    for m in mistakes
                ],
            }
        )
    return {"attempts": result_list, "total": len(result_list)}


@data_router.get("/questions/{question_id}/feedback")
async def get_question_feedback(
    question_id: int, db: AsyncSession = Depends(get_app_db)
):
    from sqlalchemy import select
    from app.models import Question

    q_result = await db.execute(
        select(Question).where(Question.question_number == question_id)
    )
    question = q_result.scalar_one_or_none() or await db.get(Question, question_id)
    if not question:
        raise HTTPException(404, "Question not found")

    service = ImportService(db)
    feedbacks = await service.get_question_feedback(question.id)
    return {
        "feedback": [
            {
                "id": f.id,
                "feedback_type": f.feedback_type,
                "feedback_text": f.feedback_text,
                "created_at": f.created_at.isoformat() if f.created_at else None,
            }
            for f in feedbacks
        ]
    }


@data_router.get("/questions/{question_id}/mistakes")
async def get_question_mistakes(
    question_id: int, db: AsyncSession = Depends(get_app_db)
):
    from sqlalchemy import select
    from app.models import Question

    q_result = await db.execute(
        select(Question).where(Question.question_number == question_id)
    )
    question = q_result.scalar_one_or_none() or await db.get(Question, question_id)
    if not question:
        raise HTTPException(404, "Question not found")

    service = ImportService(db)
    mistakes = await service.get_question_mistakes(question.id)
    return {
        "mistakes": [
            {
                "id": m.id,
                "category": m.category,
                "description": m.description,
                "correction": m.correction,
            }
            for m in mistakes
        ]
    }


# ---------------------------------------------------------------------------
# Global mistakes + concepts
# ---------------------------------------------------------------------------


@data_router.get("/mistakes")
async def get_all_mistakes(db: AsyncSession = Depends(get_app_db)):
    service = ImportService(db)
    mistakes = await service.get_all_mistakes()
    return {"mistakes": mistakes, "total": len(mistakes)}


@data_router.get("/concepts")
async def get_concepts(db: AsyncSession = Depends(get_app_db)):
    service = ImportService(db)
    concepts = await service.get_concepts_with_stats()
    return {"concepts": concepts, "total": len(concepts)}
