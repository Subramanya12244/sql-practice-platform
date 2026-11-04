"""Submission evaluation and attempt tracking."""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Optional

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import get_settings
from app.models import Attempt, ProgressEvent, Question, Solution, User
from app.schemas import SubmitResponse
from app.services.query_executor import QueryExecutor
from app.utils.difficulty import (
    FAILS_TO_DECREASE,
    STREAK_TO_INCREASE,
    next_difficulty,
    previous_difficulty,
)
from app.utils.result_compare import compare_results


class SubmissionService:
    def __init__(self, db: AsyncSession) -> None:
        self.db = db
        self.executor = QueryExecutor()
        self.settings = get_settings()

    async def submit(
        self, question_id: int, sql: str, user_id: int
    ) -> SubmitResponse:
        # Prefer primary key (frontend submits question.id after load)
        question = await self.db.get(Question, question_id)
        if not question:
            result = await self.db.execute(
                select(Question).where(Question.question_number == question_id)
            )
            question = result.scalar_one_or_none()
        if not question:
            return SubmitResponse(
                correct=False,
                message="Question not found.",
            )

        # Execute user query
        user_result = await self.executor.execute(sql, for_evaluation=True)
        if not user_result.success:
            # Still record as a failed attempt
            await self._record_attempt(
                question=question,
                user_id=user_id,
                sql=sql,
                is_correct=False,
                execution_time_ms=user_result.execution_time_ms,
                row_count=user_result.row_count,
            )
            return SubmitResponse(
                correct=False,
                message=user_result.message or "Query failed.",
                feedback=["Fix the SQL error before submitting."],
                execution_time_ms=user_result.execution_time_ms,
            )

        # Execute reference query (never returned to client).
        # If none is saved yet, the first successful Submit becomes the reference.
        reference_sql = (question.reference_query or "").strip()
        if not reference_sql:
            question.reference_query = sql.strip()
            question.has_sql = True
            if user_result.columns:
                question.expected_columns = list(user_result.columns)
            await self.db.flush()

            attempt_number = await self._record_attempt(
                question=question,
                user_id=user_id,
                sql=sql,
                is_correct=True,
                execution_time_ms=user_result.execution_time_ms,
                row_count=user_result.row_count,
            )
            user = await self._update_user_progress(user_id, True)
            await self.db.flush()

            return SubmitResponse(
                correct=True,
                message=(
                    "Correct — no reference existed yet, so this query was saved as "
                    "the grading reference for future submits."
                ),
                execution_time_ms=user_result.execution_time_ms,
                your_row_count=user_result.row_count,
                expected_row_count=user_result.row_count,
                feedback=[
                    "Reference SQL is now set from this submission.",
                    "Later submits will be compared against this result set.",
                ],
                attempt_number=attempt_number,
                consecutive_correct=user.consecutive_correct,
                suggested_difficulty=user.current_difficulty,
                level_changed=False,
            )

        ref_result = await self.executor.execute(reference_sql, for_evaluation=True)
        if not ref_result.success:
            return SubmitResponse(
                correct=False,
                message=(
                    "Unable to evaluate answer — the saved reference SQL failed to run. "
                    f"Admin detail: {ref_result.message or ref_result.error_type or 'unknown error'}"
                ),
                feedback=[],
            )

        # Prefer live reference result; fall back to stored expected_result if present
        expected_columns = ref_result.columns or (question.expected_columns or [])
        expected_rows = ref_result.rows
        if not expected_rows and question.expected_result:
            expected_rows = question.expected_result

        comparison = compare_results(
            user_columns=user_result.columns,
            user_rows=user_result.rows,
            expected_columns=expected_columns,
            expected_rows=expected_rows,
            sort_required=question.sort_required,
        )

        attempt_number = await self._record_attempt(
            question=question,
            user_id=user_id,
            sql=sql,
            is_correct=comparison.match,
            execution_time_ms=user_result.execution_time_ms,
            row_count=user_result.row_count,
        )

        user = await self._update_user_progress(user_id, comparison.match)
        level_changed = False
        suggested = user.current_difficulty

        if comparison.match and user.consecutive_correct >= STREAK_TO_INCREASE:
            new_level = next_difficulty(user.current_difficulty)
            if new_level != user.current_difficulty:
                user.current_difficulty = new_level
                user.consecutive_correct = 0
                level_changed = True
                suggested = new_level
        elif not comparison.match and user.consecutive_incorrect >= FAILS_TO_DECREASE:
            new_level = previous_difficulty(user.current_difficulty)
            if new_level != user.current_difficulty:
                user.current_difficulty = new_level
                user.consecutive_incorrect = 0
                level_changed = True
                suggested = new_level

        await self.db.flush()

        return SubmitResponse(
            correct=comparison.match,
            message=comparison.message,
            execution_time_ms=user_result.execution_time_ms,
            your_row_count=comparison.your_row_count,
            expected_row_count=comparison.expected_row_count,
            feedback=comparison.feedback,
            attempt_number=attempt_number,
            consecutive_correct=user.consecutive_correct,
            suggested_difficulty=suggested,
            level_changed=level_changed,
        )

    async def _record_attempt(
        self,
        *,
        question: Question,
        user_id: int,
        sql: str,
        is_correct: bool,
        execution_time_ms: Optional[float],
        row_count: Optional[int],
    ) -> int:
        attempt_result = await self.db.execute(
            select(Attempt).where(
                Attempt.user_id == user_id, Attempt.question_id == question.id
            )
        )
        attempt = attempt_result.scalar_one_or_none()
        if not attempt:
            attempt = Attempt(
                question_id=question.id,
                user_id=user_id,
                status="in_progress",
                attempt_count=0,
                correct_attempts=0,
            )
            self.db.add(attempt)
            await self.db.flush()

        # Don't increment attempt count if already solved and submitting again
        # (still save the solution though)
        attempt.attempt_count += 1
        attempt.last_sql = sql
        attempt_number = attempt.attempt_count

        if is_correct:
            attempt.is_correct = True
            attempt.correct_attempts = (attempt.correct_attempts or 0) + 1
            attempt.status = "solved"
            if attempt.solved_at is None:
                attempt.solved_at = datetime.now(timezone.utc)
            if execution_time_ms is not None:
                if (
                    attempt.best_execution_time_ms is None
                    or execution_time_ms < attempt.best_execution_time_ms
                ):
                    attempt.best_execution_time_ms = execution_time_ms
        else:
            if attempt.status != "solved":
                attempt.status = "in_progress"

        self.db.add(
            Solution(
                question_id=question.id,
                user_id=user_id,
                sql=sql,
                is_correct=is_correct,
                attempt_number=attempt_number,
                execution_time_ms=execution_time_ms,
                row_count=row_count,
            )
        )
        self.db.add(
            ProgressEvent(
                user_id=user_id,
                question_id=question.id,
                event_type="solved" if is_correct else "failed",
                execution_time_ms=execution_time_ms,
            )
        )
        await self.db.flush()
        return attempt_number

    async def _update_user_progress(self, user_id: int, correct: bool) -> User:
        user = await self.db.get(User, user_id)
        if not user:
            user = User(
                id=user_id,
                username=self.settings.default_user_name,
                display_name="Local User",
            )
            self.db.add(user)
            await self.db.flush()

        if correct:
            user.current_streak += 1
            user.best_streak = max(user.best_streak, user.current_streak)
            user.consecutive_correct += 1
            user.consecutive_incorrect = 0
        else:
            user.current_streak = 0
            user.consecutive_incorrect += 1
            user.consecutive_correct = 0

        await self.db.flush()
        return user

    async def get_attempt_history(
        self, question_id: int, user_id: int
    ) -> list[Solution]:
        question = await self.db.get(Question, question_id)
        if not question:
            result = await self.db.execute(
                select(Question).where(Question.question_number == question_id)
            )
            question = result.scalar_one_or_none()
        if not question:
            return []
        sol_result = await self.db.execute(
            select(Solution)
            .where(Solution.question_id == question.id, Solution.user_id == user_id)
            .order_by(Solution.attempt_number.asc())
        )
        return list(sol_result.scalars().all())
