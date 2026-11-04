"""SQLAlchemy ORM models for the application database.

Extended with ChatGPT import tables:
  ChatImport, ImportedAttempt, Feedback, Mistake, Concept, QuestionConcept
"""

from datetime import datetime
from typing import List, Optional

from sqlalchemy import (
    Boolean,
    DateTime,
    Float,
    ForeignKey,
    Integer,
    String,
    Text,
    UniqueConstraint,
    func,
)
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column, relationship


class Base(DeclarativeBase):
    pass


# ---------------------------------------------------------------------------
# Core user
# ---------------------------------------------------------------------------


class User(Base):
    __tablename__ = "users"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    username: Mapped[str] = mapped_column(String(100), unique=True, nullable=False)
    display_name: Mapped[str] = mapped_column(String(200), nullable=False)
    current_difficulty: Mapped[str] = mapped_column(String(50), default="Beginner")
    current_streak: Mapped[int] = mapped_column(Integer, default=0)
    best_streak: Mapped[int] = mapped_column(Integer, default=0)
    consecutive_correct: Mapped[int] = mapped_column(Integer, default=0)
    consecutive_incorrect: Mapped[int] = mapped_column(Integer, default=0)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )

    solutions: Mapped[List["Solution"]] = relationship(back_populates="user")
    attempts: Mapped[List["Attempt"]] = relationship(back_populates="user")


# ---------------------------------------------------------------------------
# Questions
# ---------------------------------------------------------------------------


class Project(Base):
    """A SQL practice project backed by its own PostgreSQL database."""

    __tablename__ = "projects"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    name: Mapped[str] = mapped_column(String(200), unique=True, nullable=False)
    slug: Mapped[str] = mapped_column(String(200), unique=True, nullable=False, index=True)
    description: Mapped[str] = mapped_column(Text, default="")
    database_name: Mapped[str] = mapped_column(String(120), nullable=False)
    # upload = provisioned from uploaded files, builtin = pre-existing Northwind
    source_type: Mapped[str] = mapped_column(String(50), default="upload")
    # creating | ready | error
    status: Mapped[str] = mapped_column(String(50), default="creating", index=True)
    error_message: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    folder_path: Mapped[Optional[str]] = mapped_column(String(500), nullable=True)
    github_folder: Mapped[Optional[str]] = mapped_column(String(500), nullable=True)
    table_count: Mapped[int] = mapped_column(Integer, default=0)
    row_count: Mapped[int] = mapped_column(Integer, default=0)
    er_diagram: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    is_default: Mapped[bool] = mapped_column(Boolean, default=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )

    tables: Mapped[List["ProjectTable"]] = relationship(
        back_populates="project", cascade="all, delete-orphan"
    )
    questions: Mapped[List["Question"]] = relationship(back_populates="project")


class ProjectTable(Base):
    """A table created inside a project's database from an uploaded file."""

    __tablename__ = "project_tables"
    __table_args__ = (
        UniqueConstraint("project_id", "table_name", name="uq_project_table"),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    project_id: Mapped[int] = mapped_column(
        ForeignKey("projects.id", ondelete="CASCADE"), nullable=False, index=True
    )
    table_name: Mapped[str] = mapped_column(String(120), nullable=False)
    source_file: Mapped[Optional[str]] = mapped_column(String(300), nullable=True)
    row_count: Mapped[int] = mapped_column(Integer, default=0)
    source_row_count: Mapped[int] = mapped_column(Integer, default=0)
    # [{name, pg_type, nullable, inferred_from, sample}]
    columns: Mapped[list] = mapped_column(JSONB, nullable=False, default=list)
    primary_key: Mapped[list] = mapped_column(JSONB, nullable=False, default=list)
    # [{column, references_table, references_column, confidence}]
    foreign_keys: Mapped[list] = mapped_column(JSONB, nullable=False, default=list)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )

    project: Mapped["Project"] = relationship(back_populates="tables")


class Question(Base):
    __tablename__ = "questions"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    project_id: Mapped[Optional[int]] = mapped_column(
        ForeignKey("projects.id"), nullable=True, index=True
    )
    question_number: Mapped[int] = mapped_column(
        Integer, unique=True, nullable=False, index=True
    )
    title: Mapped[str] = mapped_column(String(300), nullable=False)
    description: Mapped[str] = mapped_column(Text, nullable=False, default="")
    business_problem: Mapped[str] = mapped_column(Text, nullable=False)
    requirements: Mapped[list] = mapped_column(JSONB, nullable=False, default=list)
    difficulty: Mapped[str] = mapped_column(String(50), nullable=False, index=True)
    topic: Mapped[str] = mapped_column(String(100), nullable=False, index=True)
    subtopic: Mapped[Optional[str]] = mapped_column(String(100), nullable=True)
    tables_used: Mapped[list] = mapped_column(JSONB, nullable=False, default=list)
    # NEVER expose reference_query to the frontend before submission
    reference_query: Mapped[Optional[str]] = mapped_column(Text, nullable=True, default="")
    expected_columns: Mapped[list] = mapped_column(JSONB, nullable=False, default=list)
    expected_result: Mapped[Optional[list]] = mapped_column(JSONB, nullable=True)
    sort_required: Mapped[bool] = mapped_column(Boolean, default=False)
    starter_sql: Mapped[str] = mapped_column(Text, default="")
    hints: Mapped[list] = mapped_column(JSONB, nullable=False, default=list)
    # Full GitHub documentation fields (from .md)
    objective: Mapped[str] = mapped_column(Text, default="")
    expected_output: Mapped[str] = mapped_column(Text, default="")
    concepts_used: Mapped[list] = mapped_column(JSONB, nullable=False, default=list)
    why_this_approach: Mapped[str] = mapped_column(Text, default="")
    common_mistakes: Mapped[list] = mapped_column(JSONB, nullable=False, default=list)
    interview_followups: Mapped[list] = mapped_column(JSONB, nullable=False, default=list)
    learning_outcomes: Mapped[list] = mapped_column(JSONB, nullable=False, default=list)
    github_md_path: Mapped[Optional[str]] = mapped_column(String(500), nullable=True)
    github_sql_path: Mapped[Optional[str]] = mapped_column(String(500), nullable=True)
    folder_category: Mapped[Optional[str]] = mapped_column(String(200), nullable=True)
    related_question_numbers: Mapped[list] = mapped_column(
        JSONB, nullable=False, default=list
    )
    # GitHub documentation status — independent of practice attempts
    # documented = both .md and .sql present
    # incomplete = missing .md or .sql
    # missing_from_repo = was synced before, no longer in repo
    # app_only = exists only in app DB (e.g. ChatGPT import / extras)
    github_status: Mapped[str] = mapped_column(
        String(50), default="app_only", index=True
    )
    has_md: Mapped[bool] = mapped_column(Boolean, default=False)
    has_sql: Mapped[bool] = mapped_column(Boolean, default=False)
    content_hash: Mapped[Optional[str]] = mapped_column(String(64), nullable=True)
    last_synced_at: Mapped[Optional[datetime]] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    # Import provenance
    source_import_id: Mapped[Optional[int]] = mapped_column(
        ForeignKey("chat_imports.id"), nullable=True
    )
    source_conversation_id: Mapped[Optional[str]] = mapped_column(
        String(200), nullable=True
    )
    question_number_source: Mapped[str] = mapped_column(
        String(50), default="explicit"
    )  # explicit | inferred | manual
    # Suggested values (labelled as suggestions, not ground truth)
    suggested_difficulty: Mapped[Optional[str]] = mapped_column(
        String(50), nullable=True
    )
    suggested_topic: Mapped[Optional[str]] = mapped_column(String(100), nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )

    project: Mapped[Optional["Project"]] = relationship(back_populates="questions")
    solutions: Mapped[List["Solution"]] = relationship(back_populates="question")
    attempts: Mapped[List["Attempt"]] = relationship(back_populates="question")
    imported_attempts: Mapped[List["ImportedAttempt"]] = relationship(
        back_populates="question"
    )
    feedbacks: Mapped[List["Feedback"]] = relationship(back_populates="question")
    mistakes: Mapped[List["Mistake"]] = relationship(back_populates="question")
    question_concepts: Mapped[List["QuestionConcept"]] = relationship(
        back_populates="question"
    )


# ---------------------------------------------------------------------------
# Live solutions (user runs in the platform editor)
# ---------------------------------------------------------------------------


class Solution(Base):
    __tablename__ = "solutions"
    __table_args__ = (
        UniqueConstraint(
            "question_id", "user_id", "attempt_number", name="uq_solution_attempt"
        ),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    question_id: Mapped[int] = mapped_column(
        ForeignKey("questions.id"), nullable=False
    )
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id"), nullable=False)
    sql: Mapped[str] = mapped_column(Text, nullable=False)
    is_correct: Mapped[bool] = mapped_column(Boolean, default=False)
    attempt_number: Mapped[int] = mapped_column(Integer, nullable=False)
    execution_time_ms: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    row_count: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )

    question: Mapped["Question"] = relationship(back_populates="solutions")
    user: Mapped["User"] = relationship(back_populates="solutions")


class Attempt(Base):
    """Per-question practice progress for a user (app DB source of truth).

    Independent of github_status on Question.
    """

    __tablename__ = "attempts"
    __table_args__ = (
        UniqueConstraint("question_id", "user_id", name="uq_user_question"),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    question_id: Mapped[int] = mapped_column(
        ForeignKey("questions.id"), nullable=False
    )
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id"), nullable=False)
    # practice_status: not_started | in_progress | solved
    status: Mapped[str] = mapped_column(String(50), default="not_started")
    # How the question reached "solved": github_import | practice | chatgpt_import
    solved_source: Mapped[Optional[str]] = mapped_column(String(50), nullable=True)
    attempt_count: Mapped[int] = mapped_column(Integer, default=0)
    correct_attempts: Mapped[int] = mapped_column(Integer, default=0)
    is_correct: Mapped[bool] = mapped_column(Boolean, default=False)
    best_score: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    last_sql: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    best_execution_time_ms: Mapped[Optional[float]] = mapped_column(
        Float, nullable=True
    )
    solved_at: Mapped[Optional[datetime]] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )

    question: Mapped["Question"] = relationship(back_populates="attempts")
    user: Mapped["User"] = relationship(back_populates="attempts")


class ProgressEvent(Base):
    """Daily / event-level progress for charts."""

    __tablename__ = "progress_events"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id"), nullable=False)
    question_id: Mapped[int] = mapped_column(
        ForeignKey("questions.id"), nullable=False
    )
    event_type: Mapped[str] = mapped_column(
        String(50), nullable=False
    )  # solved | failed | run
    execution_time_ms: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )


# ---------------------------------------------------------------------------
# ChatGPT import
# ---------------------------------------------------------------------------


class ChatImport(Base):
    """Records a single ChatGPT conversations.json upload."""

    __tablename__ = "chat_imports"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    filename: Mapped[str] = mapped_column(String(300), nullable=False)
    conversation_id: Mapped[Optional[str]] = mapped_column(
        String(200), nullable=True, index=True
    )
    conversation_title: Mapped[Optional[str]] = mapped_column(
        String(500), nullable=True
    )
    start_question: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)
    end_question: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)
    questions_found: Mapped[int] = mapped_column(Integer, default=0)
    attempts_found: Mapped[int] = mapped_column(Integer, default=0)
    feedback_found: Mapped[int] = mapped_column(Integer, default=0)
    mistakes_found: Mapped[int] = mapped_column(Integer, default=0)
    scores_found: Mapped[int] = mapped_column(Integer, default=0)
    concepts_found: Mapped[int] = mapped_column(Integer, default=0)
    imported_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )


class ImportedAttempt(Base):
    """Historical SQL attempt extracted from a ChatGPT conversation."""

    __tablename__ = "imported_attempts"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    question_id: Mapped[int] = mapped_column(
        ForeignKey("questions.id"), nullable=False, index=True
    )
    import_id: Mapped[int] = mapped_column(
        ForeignKey("chat_imports.id"), nullable=False
    )
    sql: Mapped[str] = mapped_column(Text, nullable=False)
    attempt_number: Mapped[int] = mapped_column(Integer, nullable=False)
    is_correct: Mapped[Optional[bool]] = mapped_column(Boolean, nullable=True)
    score: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    score_max: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    score_text: Mapped[Optional[str]] = mapped_column(String(50), nullable=True)
    approach_notes: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    source_message_id: Mapped[Optional[str]] = mapped_column(
        String(200), nullable=True
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )

    question: Mapped["Question"] = relationship(back_populates="imported_attempts")
    feedbacks: Mapped[List["Feedback"]] = relationship(back_populates="imported_attempt")
    mistakes: Mapped[List["Mistake"]] = relationship(back_populates="imported_attempt")


class Feedback(Base):
    """ChatGPT feedback on a specific attempt."""

    __tablename__ = "feedback"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    question_id: Mapped[int] = mapped_column(
        ForeignKey("questions.id"), nullable=False, index=True
    )
    imported_attempt_id: Mapped[Optional[int]] = mapped_column(
        ForeignKey("imported_attempts.id"), nullable=True
    )
    feedback_type: Mapped[str] = mapped_column(
        String(50), nullable=False, default="general"
    )
    # correct | incorrect | partial | hint | concept_explanation |
    # mistake | optimization | interview_feedback | encouragement | general
    feedback_text: Mapped[str] = mapped_column(Text, nullable=False)
    source_message_id: Mapped[Optional[str]] = mapped_column(
        String(200), nullable=True
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )

    question: Mapped["Question"] = relationship(back_populates="feedbacks")
    imported_attempt: Mapped[Optional["ImportedAttempt"]] = relationship(
        back_populates="feedbacks"
    )


class Mistake(Base):
    """A categorised mistake identified in ChatGPT feedback."""

    __tablename__ = "mistakes"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    question_id: Mapped[int] = mapped_column(
        ForeignKey("questions.id"), nullable=False, index=True
    )
    imported_attempt_id: Mapped[Optional[int]] = mapped_column(
        ForeignKey("imported_attempts.id"), nullable=True
    )
    category: Mapped[str] = mapped_column(
        String(50), nullable=False, default="OTHER"
    )
    # JOIN_LOGIC | GROUP_BY | HAVING | AGGREGATION | CASE | COUNT_VS_SUM |
    # UNION | UNION_ALL | CTE | SUBQUERY | NULL_HANDLING | ORDERING |
    # FILTERING | DUPLICATES | ALIAS | SYNTAX | DATA_MODELING | OTHER
    description: Mapped[str] = mapped_column(Text, nullable=False)
    correction: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    source_message_id: Mapped[Optional[str]] = mapped_column(
        String(200), nullable=True
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )

    question: Mapped["Question"] = relationship(back_populates="mistakes")
    imported_attempt: Mapped[Optional["ImportedAttempt"]] = relationship(
        back_populates="mistakes"
    )


class Concept(Base):
    """SQL concept or technique."""

    __tablename__ = "concepts"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    name: Mapped[str] = mapped_column(String(100), unique=True, nullable=False)
    description: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    category: Mapped[Optional[str]] = mapped_column(String(50), nullable=True)

    question_concepts: Mapped[List["QuestionConcept"]] = relationship(
        back_populates="concept"
    )


class QuestionConcept(Base):
    """Junction: which concepts appear in which question."""

    __tablename__ = "question_concepts"
    __table_args__ = (
        UniqueConstraint("question_id", "concept_id", name="uq_question_concept"),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    question_id: Mapped[int] = mapped_column(
        ForeignKey("questions.id"), nullable=False, index=True
    )
    concept_id: Mapped[int] = mapped_column(
        ForeignKey("concepts.id"), nullable=False
    )
    source_message_id: Mapped[Optional[str]] = mapped_column(
        String(200), nullable=True
    )

    question: Mapped["Question"] = relationship(back_populates="question_concepts")
    concept: Mapped["Concept"] = relationship(back_populates="question_concepts")


# ---------------------------------------------------------------------------
# Git Practice Lab (separate from SQL questions)
# ---------------------------------------------------------------------------


class GitTopic(Base):
    """Curriculum module for Git Practice Lab."""

    __tablename__ = "git_topics"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    slug: Mapped[str] = mapped_column(String(80), unique=True, nullable=False, index=True)
    title: Mapped[str] = mapped_column(String(200), nullable=False)
    description: Mapped[str] = mapped_column(Text, default="")
    sort_order: Mapped[int] = mapped_column(Integer, default=0)

    questions: Mapped[List["GitQuestion"]] = relationship(back_populates="topic")


class GitQuestion(Base):
    """A Git practice exercise — content record, not frontend code."""

    __tablename__ = "git_questions"
    __table_args__ = (
        UniqueConstraint("stable_id", name="uq_git_question_stable_id"),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    # Stable content id e.g. "staging:001" — used for import dedupe
    stable_id: Mapped[str] = mapped_column(String(200), nullable=False, index=True)
    question_number: Mapped[int] = mapped_column(Integer, unique=True, nullable=False, index=True)
    topic_id: Mapped[int] = mapped_column(
        ForeignKey("git_topics.id"), nullable=False, index=True
    )
    title: Mapped[str] = mapped_column(String(300), nullable=False)
    # command | multiple_choice | output_interpretation | state_prediction |
    # debugging | scenario | multi_step | command_comparison | repository_state | terminal
    exercise_type: Mapped[str] = mapped_column(String(40), default="command", index=True)
    # Legacy alias kept in sync with exercise_type
    mode: Mapped[str] = mapped_column(String(40), default="command")
    scenario: Mapped[str] = mapped_column(Text, nullable=False, default="")
    objective: Mapped[str] = mapped_column(Text, nullable=False, default="")
    task: Mapped[str] = mapped_column(Text, nullable=False)
    # Easy | Medium | Hard | Expert (legacy Beginner/Intermediate mapped on read)
    difficulty: Mapped[str] = mapped_column(String(50), default="Easy", index=True)
    concepts: Mapped[list] = mapped_column(JSONB, nullable=False, default=list)
    tags: Mapped[list] = mapped_column(JSONB, nullable=False, default=list)
    repository_state: Mapped[dict] = mapped_column(JSONB, nullable=False, default=dict)
    expected_state: Mapped[dict] = mapped_column(JSONB, nullable=False, default=dict)
    expected_answer: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    accepted_solutions: Mapped[list] = mapped_column(JSONB, nullable=False, default=list)
    # For multiple_choice: [{key, text, correct?}] — correct flag never sent publicly
    choices: Mapped[list] = mapped_column(JSONB, nullable=False, default=list)
    allowed_commands: Mapped[list] = mapped_column(JSONB, nullable=False, default=list)
    hints: Mapped[list] = mapped_column(JSONB, nullable=False, default=list)
    explanation: Mapped[str] = mapped_column(Text, default="")
    common_mistakes: Mapped[list] = mapped_column(JSONB, nullable=False, default=list)
    source: Mapped[Optional[str]] = mapped_column(String(200), nullable=True)
    source_file: Mapped[Optional[str]] = mapped_column(String(400), nullable=True)
    source_section: Mapped[Optional[str]] = mapped_column(String(300), nullable=True)
    sort_order: Mapped[int] = mapped_column(Integer, default=0)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )

    topic: Mapped["GitTopic"] = relationship(back_populates="questions")
    attempts: Mapped[List["GitAttempt"]] = relationship(back_populates="question")


class GitAttempt(Base):
    """Per-user progress for a Git question."""

    __tablename__ = "git_attempts"
    __table_args__ = (
        UniqueConstraint("user_id", "question_id", name="uq_git_attempt_user_question"),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id"), nullable=False, index=True)
    question_id: Mapped[int] = mapped_column(
        ForeignKey("git_questions.id"), nullable=False, index=True
    )
    status: Mapped[str] = mapped_column(String(40), default="not_started", index=True)
    # not_started | in_progress | solved | incorrect
    attempt_count: Mapped[int] = mapped_column(Integer, default=0)
    correct_count: Mapped[int] = mapped_column(Integer, default=0)
    incorrect_count: Mapped[int] = mapped_column(Integer, default=0)
    hints_used: Mapped[int] = mapped_column(Integer, default=0)
    last_command: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    solved_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )

    question: Mapped["GitQuestion"] = relationship(back_populates="attempts")
    submissions: Mapped[List["GitSubmission"]] = relationship(back_populates="attempt")


class GitSubmission(Base):
    """Every command/answer attempt for Git practice."""

    __tablename__ = "git_submissions"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    attempt_id: Mapped[int] = mapped_column(
        ForeignKey("git_attempts.id"), nullable=False, index=True
    )
    command: Mapped[str] = mapped_column(Text, nullable=False)
    correct: Mapped[bool] = mapped_column(Boolean, default=False)
    feedback: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    resulting_state: Mapped[Optional[dict]] = mapped_column(JSONB, nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )

    attempt: Mapped["GitAttempt"] = relationship(back_populates="submissions")


class GitProgress(Base):
    """Aggregated Git skill metrics per user."""

    __tablename__ = "git_progress"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    user_id: Mapped[int] = mapped_column(
        ForeignKey("users.id"), unique=True, nullable=False, index=True
    )
    skill_score: Mapped[float] = mapped_column(Float, default=0.0)
    solved_count: Mapped[int] = mapped_column(Integer, default=0)
    attempt_count: Mapped[int] = mapped_column(Integer, default=0)
    hints_used: Mapped[int] = mapped_column(Integer, default=0)
    current_streak: Mapped[int] = mapped_column(Integer, default=0)
    best_streak: Mapped[int] = mapped_column(Integer, default=0)
    topic_mastery: Mapped[dict] = mapped_column(JSONB, nullable=False, default=dict)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )


class GitImport(Base):
    """Markdown question-bank import history."""

    __tablename__ = "git_imports"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    filename: Mapped[str] = mapped_column(String(400), nullable=False)
    imported_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )
    total_questions: Mapped[int] = mapped_column(Integer, default=0)
    imported_count: Mapped[int] = mapped_column(Integer, default=0)
    skipped_count: Mapped[int] = mapped_column(Integer, default=0)
    failed_count: Mapped[int] = mapped_column(Integer, default=0)
    duplicate_count: Mapped[int] = mapped_column(Integer, default=0)
    warning_count: Mapped[int] = mapped_column(Integer, default=0)
    modules_touched: Mapped[list] = mapped_column(JSONB, nullable=False, default=list)
    report: Mapped[dict] = mapped_column(JSONB, nullable=False, default=dict)
    status: Mapped[str] = mapped_column(String(40), default="completed")  # previewed | completed | cancelled
    user_id: Mapped[Optional[int]] = mapped_column(ForeignKey("users.id"), nullable=True)
