"""Question loading, listing, and sync from local JSON / GitHub."""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any, Dict, List, Optional

from sqlalchemy import select, func
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import get_settings
from app.models import (
    Attempt,
    Feedback,
    ImportedAttempt,
    Mistake,
    ProgressEvent,
    Question,
    QuestionConcept,
    Solution,
)
from app.schemas import QuestionPublic, QuestionSummary
from app.services.repo_parser import folder_for_topic
from app.services.schema_service import normalize_table_names
from app.utils.difficulty import map_legacy_difficulty


class QuestionService:
    def __init__(self, db: AsyncSession) -> None:
        self.db = db
        self.settings = get_settings()

    async def list_questions(
        self,
        *,
        user_id: int,
        difficulty: Optional[str] = None,
        topic: Optional[str] = None,
        status: Optional[str] = None,
        search: Optional[str] = None,
    ) -> tuple[List[QuestionSummary], int]:
        q = select(Question).order_by(Question.question_number)
        if difficulty:
            q = q.where(Question.difficulty == difficulty)
        if topic:
            q = q.where(Question.topic == topic)
        if search:
            pattern = f"%{search}%"
            q = q.where(
                Question.title.ilike(pattern)
                | Question.description.ilike(pattern)
                | Question.business_problem.ilike(pattern)
            )

        result = await self.db.execute(q)
        questions = list(result.scalars().all())

        # Load attempt statuses for this user
        attempt_result = await self.db.execute(
            select(Attempt).where(Attempt.user_id == user_id)
        )
        attempts_by_qid = {a.question_id: a for a in attempt_result.scalars().all()}

        summaries: List[QuestionSummary] = []
        for question in questions:
            attempt = attempts_by_qid.get(question.id)
            q_status = attempt.status if attempt else "not_started"
            if status and q_status != status:
                continue
            summaries.append(
                QuestionSummary(
                    id=question.id,
                    question_number=question.question_number,
                    title=question.title,
                    difficulty=question.difficulty,
                    topic=question.topic,
                    subtopic=question.subtopic,
                    status=q_status,
                    github_status=question.github_status or "app_only",
                    has_md=bool(question.has_md),
                    has_sql=bool(question.has_sql),
                    folder_category=question.folder_category,
                )
            )

        return summaries, len(summaries)

    async def get_question_public(
        self, question_id: int, user_id: int
    ) -> Optional[QuestionPublic]:
        # Prefer question_number — frontend routes use Q numbers in the URL
        result = await self.db.execute(
            select(Question).where(Question.question_number == question_id)
        )
        question = result.scalar_one_or_none()
        if not question:
            question = await self.db.get(Question, question_id)
        if not question:
            return None

        attempt_result = await self.db.execute(
            select(Attempt).where(
                Attempt.user_id == user_id, Attempt.question_id == question.id
            )
        )
        attempt = attempt_result.scalar_one_or_none()

        return QuestionPublic(
            id=question.id,
            question_number=question.question_number,
            title=question.title,
            description=question.description,
            business_problem=question.business_problem,
            requirements=question.requirements or [],
            difficulty=question.difficulty,
            topic=question.topic,
            subtopic=question.subtopic,
            tables_used=normalize_table_names(question.tables_used or []),
            expected_columns=question.expected_columns or [],
            sort_required=question.sort_required,
            starter_sql=question.starter_sql or "",
            status=attempt.status if attempt else "not_started",
            attempt_count=attempt.attempt_count if attempt else 0,
            objective=question.objective or "",
            expected_output=question.expected_output or "",
            concepts_used=question.concepts_used or [],
            why_this_approach=question.why_this_approach or "",
            common_mistakes=question.common_mistakes or [],
            interview_followups=question.interview_followups or [],
            learning_outcomes=question.learning_outcomes or [],
            folder_category=question.folder_category,
            related_question_numbers=question.related_question_numbers or [],
            github_md_path=question.github_md_path,
            has_reference_query=bool(question.reference_query and question.reference_query.strip()),
            suggested_difficulty=question.suggested_difficulty,
            suggested_topic=question.suggested_topic,
            github_status=question.github_status or "app_only",
            has_md=bool(question.has_md),
            has_sql=bool(question.has_sql),
            practice_status=attempt.status if attempt else "not_started",
            correct_attempts=attempt.correct_attempts if attempt else 0,
            best_score=attempt.best_score if attempt else None,
        )

    async def get_question_internal(self, question_id: int) -> Optional[Question]:
        result = await self.db.execute(
            select(Question).where(Question.question_number == question_id)
        )
        question = result.scalar_one_or_none()
        if question:
            return question
        return await self.db.get(Question, question_id)
    async def get_topics(self) -> List[dict]:
        result = await self.db.execute(
            select(Question.topic, func.count(Question.id))
            .group_by(Question.topic)
            .order_by(Question.topic)
        )
        return [{"name": row[0], "question_count": row[1]} for row in result.all()]

    async def create_question(self, data: Dict[str, Any]) -> Question:
        """Create a manually authored question.

        Always prefers an explicit question_number from markdown when provided.
        If that number is already used, the existing question is shifted to the
        next free number so the MD number can be used.
        """
        self._last_create_shift: Optional[tuple[int, int, str]] = None
        requested = data.get("question_number")
        if requested is not None and str(requested).strip() != "":
            qnum = int(requested)
            clash = (
                await self.db.execute(
                    select(Question).where(Question.question_number == qnum)
                )
            ).scalar_one_or_none()
            if clash:
                next_n = await self._next_free_question_number()
                old_title = clash.title
                clash.question_number = next_n
                await self.db.flush()
                self._last_create_shift = (qnum, next_n, old_title)
            source = "markdown"
        else:
            qnum = await self._next_free_question_number()
            source = "manual"

        folder = data.get("folder_category") or folder_for_topic(
            data.get("topic", "SELECT")
        )
        question = Question(
            question_number=qnum,
            project_id=data.get("project_id"),
            title=data["title"],
            description=data.get("objective") or data["business_problem"],
            business_problem=data["business_problem"],
            requirements=data.get("requirements") or [],
            difficulty=map_legacy_difficulty(str(data.get("difficulty", "Intermediate"))),
            topic=data.get("topic", "SELECT"),
            subtopic=data.get("subtopic"),
            tables_used=data.get("tables_used") or [],
            reference_query=data.get("reference_query") or "",
            expected_columns=data.get("expected_columns") or [],
            sort_required=bool(data.get("sort_required", False)),
            starter_sql=data.get("starter_sql") or "",
            hints=data.get("hints") or [],
            objective=data.get("objective") or "",
            expected_output=data.get("expected_output") or "",
            concepts_used=data.get("concepts_used") or [],
            why_this_approach=data.get("why_this_approach") or "",
            common_mistakes=data.get("common_mistakes") or [],
            interview_followups=data.get("interview_followups") or [],
            learning_outcomes=data.get("learning_outcomes") or [],
            related_question_numbers=data.get("related_question_numbers") or [],
            folder_category=folder,
            github_status="app_only",
            has_md=False,
            has_sql=bool((data.get("reference_query") or "").strip()),
            question_number_source=source,
        )
        question.tables_used = normalize_table_names(question.tables_used)
        question.expected_columns = normalize_table_names(question.expected_columns)
        self.db.add(question)
        await self.db.flush()
        return question

    async def _next_free_question_number(self) -> int:
        max_n = (
            await self.db.execute(select(func.max(Question.question_number)))
        ).scalar_one_or_none()
        return (max_n or 0) + 1

    def consume_create_shift(self) -> Optional[tuple[int, int, str]]:
        """Return (md_number, shifted_to, old_title) if the last create relocated a clash."""
        shift = getattr(self, "_last_create_shift", None)
        self._last_create_shift = None
        return shift

    async def upsert_from_dicts(self, items: List[Dict[str, Any]]) -> int:
        """Insert or update questions from a list of dicts (from JSON / GitHub)."""
        count = 0
        for item in items:
            qnum = int(item["question_number"])
            result = await self.db.execute(
                select(Question).where(Question.question_number == qnum)
            )
            existing = result.scalar_one_or_none()

            difficulty = map_legacy_difficulty(str(item.get("difficulty", "Intermediate")))
            payload = {
                "question_number": qnum,
                "title": item.get("title", f"Question {qnum}"),
                "description": item.get("description", ""),
                "business_problem": item.get("business_problem", ""),
                "requirements": item.get("requirements", []),
                "difficulty": difficulty,
                "topic": item.get("topic", "SELECT"),
                "subtopic": item.get("subtopic"),
                "tables_used": normalize_table_names(item.get("tables_used", [])),
                "reference_query": item.get("reference_query") or "",
                "expected_columns": item.get("expected_columns", []),
                "expected_result": item.get("expected_result"),
                "sort_required": bool(item.get("sort_required", False)),
                "starter_sql": item.get("starter_sql", ""),
                "hints": item.get("hints", []),
                "objective": item.get("objective", ""),
                "expected_output": item.get("expected_output", ""),
                "concepts_used": item.get("concepts_used", []),
                "why_this_approach": item.get("why_this_approach", ""),
                "common_mistakes": item.get("common_mistakes", []),
                "interview_followups": item.get("interview_followups", []),
                "learning_outcomes": item.get("learning_outcomes", []),
                "github_md_path": item.get("github_md_path"),
                "github_sql_path": item.get("github_sql_path"),
                "folder_category": item.get("folder_category"),
                "related_question_numbers": item.get("related_question_numbers", []),
                "has_md": bool(item.get("has_md", bool(item.get("github_md_path")))),
                "has_sql": bool(item.get("has_sql", bool(item.get("github_sql_path")))),
                "github_status": item.get("github_status")
                or (
                    "documented"
                    if item.get("has_md") and item.get("has_sql")
                    else "app_only"
                ),
                "content_hash": item.get("content_hash"),
            }

            if existing:
                for key, value in payload.items():
                    setattr(existing, key, value)
            else:
                self.db.add(Question(**payload))
            count += 1

        await self.db.flush()
        return count

    async def load_from_local_file(self, path: Optional[str] = None) -> int:
        settings = self.settings
        file_path = Path(path or settings.questions_file_path)
        if not file_path.is_absolute():
            # Resolve relative to backend working directory / monorepo root
            candidates = [
                Path.cwd() / file_path,
                Path.cwd().parent / file_path,
                Path(__file__).resolve().parents[3] / "questions" / "questions.json",
                Path("/app/questions/questions.json"),
            ]
            for candidate in candidates:
                if candidate.exists():
                    file_path = candidate
                    break

        if not file_path.exists():
            return 0

        data = json.loads(file_path.read_text(encoding="utf-8"))
        if isinstance(data, dict):
            items = data.get("questions", [])
        else:
            items = data
        return await self.upsert_from_dicts(items)

    async def delete_question(self, question_id: int) -> dict:
        """Delete a question and all related practice / import rows.

        Does not delete files from the GitHub/local repo — only the app database.
        Accepts either primary key id or question_number.
        """
        question = await self.db.get(Question, question_id)
        if not question:
            result = await self.db.execute(
                select(Question).where(Question.question_number == question_id)
            )
            question = result.scalar_one_or_none()
        if not question:
            raise ValueError("Question not found")

        qid = question.id
        qnum = question.question_number
        title = question.title

        # Child tables first (no ON DELETE CASCADE on these FKs)
        for model in (
            Feedback,
            Mistake,
            QuestionConcept,
            ImportedAttempt,
            ProgressEvent,
            Solution,
            Attempt,
        ):
            rows = (
                await self.db.execute(select(model).where(model.question_id == qid))
            ).scalars().all()
            for row in rows:
                await self.db.delete(row)

        await self.db.delete(question)
        await self.db.flush()

        return {
            "success": True,
            "question_id": qid,
            "question_number": qnum,
            "title": title,
            "message": (
                f"Deleted Q{qnum} — {title}. "
                "Related attempts and import history were removed from the app database. "
                "Repo .md/.sql files (if any) were left unchanged."
            ),
        }
