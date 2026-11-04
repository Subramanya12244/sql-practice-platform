"""Pydantic schemas for Git Practice Lab."""

from __future__ import annotations

from typing import Any, Dict, List, Optional

from pydantic import BaseModel, Field


class GitTopicOut(BaseModel):
    id: int
    slug: str
    title: str
    description: str
    sort_order: int
    question_count: int = 0
    solved_count: int = 0


class GitQuestionSummary(BaseModel):
    id: int
    stable_id: str = ""
    question_number: int
    title: str
    topic: str
    topic_slug: str
    difficulty: str
    mode: str
    exercise_type: str = "command"
    concepts: List[str] = Field(default_factory=list)
    tags: List[str] = Field(default_factory=list)
    status: str = "not_started"
    attempt_count: int = 0
    hints_used: int = 0


class GitQuestionDetail(GitQuestionSummary):
    scenario: str
    objective: str
    task: str
    repository_state: Optional[Dict[str, Any]] = None
    allowed_commands: List[str] = Field(default_factory=list)
    hints_available: int = 0
    common_mistakes: List[str] = Field(default_factory=list)
    choices: List[Dict[str, Any]] = Field(default_factory=list)


class GitHintResponse(BaseModel):
    hint_index: int
    hint: str
    hints_remaining: int
    solution: Optional[str] = None


class GitExecuteRequest(BaseModel):
    command: str
    question_id: Optional[int] = None
    reset: bool = False


class GitExecuteResponse(BaseModel):
    ok: bool
    output: str
    error: Optional[str] = None
    state: Dict[str, Any]


class GitAttemptRequest(BaseModel):
    question_id: int
    command: str
    hint_index: int = 0


class GitAttemptResponse(BaseModel):
    correct: bool
    result: str
    output: str = ""
    state: Dict[str, Any] = Field(default_factory=dict)
    state_changes: List[str] = Field(default_factory=list)
    feedback: str
    explanation: Optional[str] = None
    next_hint: Optional[str] = None
    concept_tip: Optional[str] = None
    status: str = "in_progress"
    attempt_count: int = 0


class GitTopicMastery(BaseModel):
    slug: str
    title: str
    total: int
    solved: int
    percent: float


class GitProgressOut(BaseModel):
    skill_score: float
    solved_count: int
    total_questions: int
    accuracy: float
    attempt_count: int
    hints_used: int
    current_streak: int
    best_streak: int
    average_attempts: float
    topic_mastery: List[GitTopicMastery]
    module_count: int = 0
    modules_with_content: int = 0


class GitResetResponse(BaseModel):
    ok: bool
    state: Dict[str, Any]
    message: str


class GitSelectRequest(BaseModel):
    strategy: str = "smart"
    topic: Optional[str] = None
    difficulty: Optional[str] = None
    after_id: Optional[int] = None


class GitImportIssue(BaseModel):
    level: str
    message: str


class GitImportExercisePreview(BaseModel):
    stable_id: str
    exercise_code: str
    module_title: str
    module_slug: str
    title: str
    exercise_type: str
    difficulty: str
    task: str
    issues: List[GitImportIssue] = Field(default_factory=list)
    is_duplicate: bool = False
    errors: List[str] = Field(default_factory=list)
    warnings: List[str] = Field(default_factory=list)


class GitImportPreview(BaseModel):
    preview_id: str
    filename: str
    modules: List[Dict[str, str]]
    exercises: List[Dict[str, Any]]
    counts: Dict[str, int]
    by_difficulty: Dict[str, int]
    by_type: Dict[str, int]


class GitImportConfirmRequest(BaseModel):
    preview_id: str
    skip_duplicates: bool = True
    import_valid_only: bool = True


class GitImportConfirmResult(BaseModel):
    import_id: int
    filename: str
    total_questions: int
    imported: int
    skipped: int
    failed: int
    duplicates: int
    modules_touched: List[str]


class GitImportHistoryItem(BaseModel):
    id: int
    filename: str
    imported_at: Optional[str] = None
    total_questions: int
    imported_count: int
    skipped_count: int
    failed_count: int
    duplicate_count: int
    warning_count: int = 0
    modules_touched: List[str] = Field(default_factory=list)
    status: str
