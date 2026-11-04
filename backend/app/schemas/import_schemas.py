"""Schemas for ChatGPT import API."""

from __future__ import annotations

from typing import Any, Dict, List, Optional

from pydantic import BaseModel


# ---------------------------------------------------------------------------
# Scan
# ---------------------------------------------------------------------------


class ConversationSummary(BaseModel):
    conversation_id: str
    title: str
    relevance_score: float
    message_count: int
    sql_block_count: int
    q_range_min: Optional[int] = None
    q_range_max: Optional[int] = None
    match_reasons: List[str]


class ScanResponse(BaseModel):
    conversations: List[ConversationSummary]
    total_found: int


# ---------------------------------------------------------------------------
# Preview
# ---------------------------------------------------------------------------


class PreviewAttempt(BaseModel):
    attempt_number: int
    sql: str
    is_correct: Optional[bool]
    score_text: Optional[str]
    approach_notes: Optional[str]
    feedback_count: int
    mistake_count: int


class PreviewQuestion(BaseModel):
    question_number: int
    question_number_source: str  # explicit | inferred
    title: Optional[str]
    business_problem: Optional[str]
    requirements: List[str]
    tables_used: List[str]
    difficulty: Optional[str]
    topic: Optional[str]
    suggested_difficulty: Optional[str]
    suggested_topic: Optional[str]
    attempts: List[PreviewAttempt]
    feedback_count: int
    mistake_count: int
    concept_count: int
    score_text: Optional[str]
    exists_in_db: bool = False
    db_question_id: Optional[int] = None


class PreviewResponse(BaseModel):
    conversation_id: str
    conversation_title: str
    start_question: int
    end_question: Optional[int]
    questions: List[PreviewQuestion]
    total_questions: int
    total_attempts: int
    total_feedback: int
    total_mistakes: int
    total_scores: int
    total_concepts: int


# ---------------------------------------------------------------------------
# Confirm
# ---------------------------------------------------------------------------


class QuestionImportAction(BaseModel):
    question_number: int
    action: str = "import"  # import | skip | update
    # Optional overrides from the review editor
    title: Optional[str] = None
    difficulty: Optional[str] = None
    topic: Optional[str] = None
    business_problem: Optional[str] = None
    requirements: Optional[List[str]] = None
    tables_used: Optional[List[str]] = None


class ConfirmImportRequest(BaseModel):
    conversation_id: str
    start_question: int = 59
    questions: List[QuestionImportAction]
    # Raw conversations.json is NOT re-sent — we store it from the scan step
    raw_payload_key: Optional[str] = None  # session key if needed


class ImportSummary(BaseModel):
    questions_new: int
    questions_updated: int
    questions_skipped: int
    attempts_imported: int
    feedback_imported: int
    mistakes_imported: int
    concepts_imported: int
    import_id: int
