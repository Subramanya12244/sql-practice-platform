"""Pydantic request/response schemas.

IMPORTANT: QuestionPublic never includes reference_query.
"""

from datetime import datetime
from typing import Any, List, Optional

from pydantic import BaseModel, Field


# ---------------------------------------------------------------------------
# Questions
# ---------------------------------------------------------------------------


class QuestionSummary(BaseModel):
    id: int
    question_number: int
    title: str
    difficulty: str
    topic: str
    subtopic: Optional[str] = None
    status: str = "not_started"  # practice_status
    github_status: str = "app_only"
    has_md: bool = False
    has_sql: bool = False
    folder_category: Optional[str] = None

    model_config = {"from_attributes": True}


class QuestionPublic(BaseModel):
    """Safe question payload for the frontend — no reference SQL."""

    id: int
    question_number: int
    title: str
    description: str
    business_problem: str
    requirements: List[str]
    difficulty: str
    topic: str
    subtopic: Optional[str] = None
    tables_used: List[str]
    expected_columns: List[str]
    sort_required: bool
    starter_sql: str = ""
    status: str = "not_started"
    attempt_count: int = 0
    # Extended documentation fields (never include reference_query)
    objective: str = ""
    expected_output: str = ""
    concepts_used: List[str] = []
    why_this_approach: str = ""
    common_mistakes: List[str] = []
    interview_followups: List[Any] = []
    learning_outcomes: List[str] = []
    folder_category: Optional[str] = None
    related_question_numbers: List[int] = []
    github_md_path: Optional[str] = None
    has_reference_query: bool = False
    suggested_difficulty: Optional[str] = None
    suggested_topic: Optional[str] = None
    github_status: str = "app_only"
    has_md: bool = False
    has_sql: bool = False
    practice_status: str = "not_started"
    correct_attempts: int = 0
    best_score: Optional[float] = None

    model_config = {"from_attributes": True}


class QuestionListResponse(BaseModel):
    questions: List[QuestionSummary]
    total: int


class QuestionCreateRequest(BaseModel):
    """Manually authored question. Always starts unsolved."""

    title: str = Field(..., min_length=3, max_length=300)
    topic: str = Field(..., min_length=1, max_length=100)
    difficulty: str = Field(..., min_length=1, max_length=50)
    business_problem: str = Field(..., min_length=5)
    tables_used: List[str] = []
    expected_output: str = ""
    expected_columns: List[str] = []
    requirements: List[str] = []
    objective: str = ""
    subtopic: Optional[str] = None
    folder_category: Optional[str] = None
    concepts_used: List[str] = []
    starter_sql: str = ""
    hints: List[str] = []
    sort_required: bool = False
    why_this_approach: str = ""
    common_mistakes: List[str] = []
    interview_followups: List[Any] = []
    learning_outcomes: List[str] = []
    related_question_numbers: List[int] = []
    # Optional — kept server-side, never returned in QuestionPublic
    reference_query: Optional[str] = None
    question_number: Optional[int] = None
    project_id: Optional[int] = None


class QuestionCreateResponse(BaseModel):
    success: bool
    question_id: int
    question_number: int
    title: str
    status: str = "not_started"
    message: str
    shifted_from_number: Optional[int] = None
    shifted_question_number: Optional[int] = None
    shifted_title: Optional[str] = None


class QuestionDeleteResponse(BaseModel):
    success: bool
    question_id: int
    question_number: int
    title: str
    message: str


class SetReferenceRequest(BaseModel):
    sql: str = Field(..., min_length=1)


class SetReferenceResponse(BaseModel):
    success: bool
    question_number: int
    message: str
    has_reference_query: bool = True


class MarkdownParseRequest(BaseModel):
    """Paste markdown text to extract question fields."""

    markdown: str = Field(..., min_length=10)
    filename: Optional[str] = None


class MarkdownParseResponse(BaseModel):
    success: bool
    message: str
    title: str = ""
    topic: str = ""
    difficulty: str = "Intermediate"
    business_problem: str = ""
    objective: str = ""
    tables_used: List[str] = []
    expected_output: str = ""
    expected_columns: List[str] = []
    requirements: List[str] = []
    concepts_used: List[str] = []
    common_mistakes: List[str] = []
    why_this_approach: str = ""
    interview_followups: List[Any] = []
    learning_outcomes: List[str] = []
    folder_category: Optional[str] = None
    subtopic: Optional[str] = None
    question_number: Optional[int] = None
    reference_query: str = ""
    related_question_numbers: List[int] = []
    fields_found: List[str] = []


# ---------------------------------------------------------------------------
# Query execution
# ---------------------------------------------------------------------------


class ExecuteQueryRequest(BaseModel):
    question_id: Optional[int] = None
    project_id: Optional[int] = None
    sql: str = Field(..., min_length=1)


class ExecuteQueryResponse(BaseModel):
    success: bool
    execution_time_ms: Optional[float] = None
    row_count: Optional[int] = None
    columns: List[str] = []
    rows: List[List[Any]] = []
    error_type: Optional[str] = None
    message: Optional[str] = None
    truncated: bool = False


class SubmitRequest(BaseModel):
    sql: str = Field(..., min_length=1)


class SubmitResponse(BaseModel):
    correct: bool
    message: str
    execution_time_ms: Optional[float] = None
    your_row_count: Optional[int] = None
    expected_row_count: Optional[int] = None
    feedback: List[str] = []
    attempt_number: Optional[int] = None
    consecutive_correct: Optional[int] = None
    suggested_difficulty: Optional[str] = None
    level_changed: bool = False


# ---------------------------------------------------------------------------
# Attempts / solutions
# ---------------------------------------------------------------------------


class AttemptHistoryItem(BaseModel):
    attempt_number: int
    is_correct: bool
    sql: str
    execution_time_ms: Optional[float] = None
    row_count: Optional[int] = None
    created_at: datetime

    model_config = {"from_attributes": True}


class AttemptHistoryResponse(BaseModel):
    attempts: List[AttemptHistoryItem]
    total: int


# ---------------------------------------------------------------------------
# Progress
# ---------------------------------------------------------------------------


class TopicStats(BaseModel):
    topic: str
    total: int
    solved: int
    accuracy: float


class DifficultyStats(BaseModel):
    difficulty: str
    total: int
    solved: int


class SolvedOverTime(BaseModel):
    date: str
    count: int


class GitHubSyncResponse(BaseModel):
    success: bool
    message: str
    questions_synced: int = 0
    source: str = "local"
    # Change detection report
    new: int = 0
    modified: int = 0
    deleted: int = 0
    unchanged: int = 0
    auto_solved: int = 0
    total_in_repo: int = 0
    next_question_number: Optional[int] = None
    new_question_numbers: List[int] = []
    modified_question_numbers: List[int] = []
    deleted_question_numbers: List[int] = []
    new_categories: List[str] = []
    difficulty_changes: List[dict] = []
    incomplete_files: List[dict] = []


class RepositoryProgress(BaseModel):
    total_questions: int
    documented: int
    incomplete: int
    missing_from_repo: int
    app_only: int
    by_category: List[dict]
    by_difficulty: List[dict]
    missing_md: List[int]
    missing_sql: List[int]
    next_question_number: int
    max_question_number: Optional[int] = None
    repository: str


class ProgressResponse(BaseModel):
    total_questions: int
    solved: int
    remaining: int = 0
    in_progress: int
    not_started: int
    accuracy: float
    average_score: Optional[float] = None
    avg_attempts_per_question: Optional[float] = None
    current_level: str
    current_streak: int
    best_streak: int
    consecutive_correct: int
    by_topic: List[TopicStats]
    by_difficulty: List[DifficultyStats]
    solved_over_time: List[SolvedOverTime]
    avg_execution_time_ms: Optional[float] = None
    weak_concepts: List[dict] = []
    recent_mistakes: List[dict] = []
    # Separated progress views
    repository: Optional[RepositoryProgress] = None
    questions_attempted: int = 0
    questions_solved_correctly: int = 0
    solved_from_repo: int = 0
    solved_in_practice: int = 0


class GitHubDocsPreview(BaseModel):
    question_number: int
    md_path: str
    sql_path: str
    markdown: str
    sql: str
    will_push: bool = False
    message: str


class GitHubDocsConfirmRequest(BaseModel):
    question_number: int
    # Default True: Approve writes locally and pushes when token is configured.
    push_to_github: bool = True
    # Optional edited content from the review modal. When omitted, regenerates.
    markdown: Optional[str] = None
    sql: Optional[str] = None


class GitHubDocsConfirmResponse(BaseModel):
    success: bool
    message: str
    md_path: str
    sql_path: str
    pushed: bool = False


class NextQuestionNumberResponse(BaseModel):
    next_question_number: int
    max_existing: Optional[int] = None


class ColumnInfo(BaseModel):
    name: str
    data_type: str
    is_nullable: bool = True


class TableSchema(BaseModel):
    table_name: str
    columns: List[ColumnInfo]


class SchemaResponse(BaseModel):
    tables: List[TableSchema]


class TopicItem(BaseModel):
    name: str
    question_count: int


class TopicsResponse(BaseModel):
    topics: List[TopicItem]

