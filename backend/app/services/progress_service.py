"""Progress dashboard aggregation."""

from __future__ import annotations

from collections import defaultdict
from typing import Dict, List

from sqlalchemy import Integer, cast, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import (
    Attempt,
    ImportedAttempt,
    Mistake,
    ProgressEvent,
    Question,
    Solution,
    User,
)
from app.schemas import (
    DifficultyStats,
    ProgressResponse,
    SolvedOverTime,
    TopicStats,
)


class ProgressService:
    def __init__(self, db: AsyncSession) -> None:
        self.db = db

    async def get_progress(self, user_id: int) -> ProgressResponse:
        total = (
            await self.db.execute(select(func.count(Question.id)))
        ).scalar_one()

        attempts = list(
            (
                await self.db.execute(
                    select(Attempt).where(Attempt.user_id == user_id)
                )
            )
            .scalars()
            .all()
        )

        solved = sum(1 for a in attempts if a.status == "solved")
        solved_from_repo = sum(
            1
            for a in attempts
            if a.status == "solved" and a.solved_source == "github_import"
        )
        solved_in_practice = solved - solved_from_repo
        in_progress = sum(1 for a in attempts if a.status == "in_progress")
        not_started = max(0, total - solved - in_progress)
        remaining = max(0, total - solved)

        sol_stats = (
            await self.db.execute(
                select(
                    func.count(Solution.id),
                    func.sum(cast(Solution.is_correct, Integer)),
                ).where(Solution.user_id == user_id)
            )
        ).one()
        total_subs = sol_stats[0] or 0
        correct_subs = int(sol_stats[1] or 0)
        accuracy = round((correct_subs / total_subs) * 100, 1) if total_subs else 0.0

        avg_score_row = (
            await self.db.execute(
                select(func.avg(ImportedAttempt.score)).where(
                    ImportedAttempt.score.is_not(None)
                )
            )
        ).scalar_one()
        average_score = (
            round(float(avg_score_row), 2) if avg_score_row is not None else None
        )

        live_attempts_sum = sum(a.attempt_count for a in attempts) if attempts else 0
        imported_count = (
            await self.db.execute(select(func.count(ImportedAttempt.id)))
        ).scalar_one() or 0
        avg_attempts = (
            round((live_attempts_sum + imported_count) / max(total, 1), 2)
            if total
            else None
        )

        user = await self.db.get(User, user_id)
        current_level = user.current_difficulty if user else "Beginner"
        current_streak = user.current_streak if user else 0
        best_streak = user.best_streak if user else 0
        consecutive_correct = user.consecutive_correct if user else 0

        questions = list((await self.db.execute(select(Question))).scalars().all())
        q_by_id = {q.id: q for q in questions}
        topic_totals: Dict[str, int] = defaultdict(int)
        topic_solved: Dict[str, int] = defaultdict(int)
        for q in questions:
            topic_totals[q.topic] += 1
        for a in attempts:
            q = q_by_id.get(a.question_id)
            if q and a.status == "solved":
                topic_solved[q.topic] += 1

        by_topic: List[TopicStats] = []
        for topic, t_total in sorted(topic_totals.items()):
            s = topic_solved.get(topic, 0)
            by_topic.append(
                TopicStats(
                    topic=topic,
                    total=t_total,
                    solved=s,
                    accuracy=round((s / t_total) * 100, 1) if t_total else 0.0,
                )
            )

        diff_totals: Dict[str, int] = defaultdict(int)
        diff_solved: Dict[str, int] = defaultdict(int)
        for q in questions:
            diff_totals[q.difficulty] += 1
        for a in attempts:
            q = q_by_id.get(a.question_id)
            if q and a.status == "solved":
                diff_solved[q.difficulty] += 1

        order = ["Beginner", "Intermediate", "Advanced", "Senior", "Expert"]
        by_difficulty = [
            DifficultyStats(
                difficulty=d,
                total=diff_totals.get(d, 0),
                solved=diff_solved.get(d, 0),
            )
            for d in order
            if diff_totals.get(d, 0) > 0
        ]

        events = list(
            (
                await self.db.execute(
                    select(ProgressEvent)
                    .where(
                        ProgressEvent.user_id == user_id,
                        ProgressEvent.event_type == "solved",
                    )
                    .order_by(ProgressEvent.created_at.asc())
                )
            )
            .scalars()
            .all()
        )
        day_counts: Dict[str, int] = defaultdict(int)
        for e in events:
            day = e.created_at.strftime("%Y-%m-%d")
            day_counts[day] += 1
        solved_over_time = [
            SolvedOverTime(date=d, count=c) for d, c in sorted(day_counts.items())
        ]

        avg_time = (
            await self.db.execute(
                select(func.avg(Solution.execution_time_ms)).where(
                    Solution.user_id == user_id, Solution.is_correct.is_(True)
                )
            )
        ).scalar_one()

        weak_concepts: List[dict] = []
        mistake_cats = (
            await self.db.execute(
                select(Mistake.category, func.count(Mistake.id))
                .group_by(Mistake.category)
                .order_by(func.count(Mistake.id).desc())
                .limit(8)
            )
        ).all()
        for cat, cnt in mistake_cats:
            weak_concepts.append(
                {
                    "name": cat.replace("_", " "),
                    "mistake_count": cnt,
                    "kind": "mistake",
                }
            )

        recent = (
            await self.db.execute(
                select(
                    Mistake.category,
                    Mistake.description,
                    Mistake.correction,
                    Question.question_number,
                    Question.title,
                    Mistake.created_at,
                )
                .join(Question, Mistake.question_id == Question.id)
                .order_by(Mistake.created_at.desc())
                .limit(10)
            )
        ).all()
        recent_mistakes = [
            {
                "category": r.category,
                "description": r.description,
                "correction": r.correction,
                "question_number": r.question_number,
                "question_title": r.title,
                "created_at": r.created_at.isoformat() if r.created_at else None,
            }
            for r in recent
        ]

        return ProgressResponse(
            total_questions=total,
            solved=solved,
            remaining=remaining,
            in_progress=in_progress,
            not_started=not_started,
            accuracy=accuracy,
            average_score=average_score,
            avg_attempts_per_question=avg_attempts,
            current_level=current_level,
            current_streak=current_streak,
            best_streak=best_streak,
            consecutive_correct=consecutive_correct,
            by_topic=by_topic,
            by_difficulty=by_difficulty,
            solved_over_time=solved_over_time,
            avg_execution_time_ms=round(float(avg_time), 2) if avg_time else None,
            weak_concepts=weak_concepts,
            recent_mistakes=recent_mistakes,
            questions_attempted=sum(1 for a in attempts if a.attempt_count > 0),
            questions_solved_correctly=solved,
            solved_from_repo=solved_from_repo,
            solved_in_practice=solved_in_practice,
            repository=None,  # filled by route
        )
