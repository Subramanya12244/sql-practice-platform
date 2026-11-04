"""Git Practice Lab — questions, sessions, evaluation, progress."""

from __future__ import annotations

import json
import re
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.config import get_settings
from app.models import (
    GitAttempt,
    GitProgress,
    GitQuestion,
    GitSubmission,
    GitTopic,
)
from app.services.git_import_service import GitImportService
from app.services.git_lab.curriculum import (
    LEGACY_TOPIC_MAP,
    normalize_difficulty,
    normalize_type,
)
from app.services.git_lab.evaluator import evaluate_command
from app.services.git_lab.executor import execute_command
from app.services.git_lab.state import state_from_dict


# In-memory practice sessions: (user_id, question_id) -> public/raw state dict
_sessions: Dict[Tuple[int, int], Dict[str, Any]] = {}


class GitLabService:
    def __init__(self, db: AsyncSession) -> None:
        self.db = db
        self.settings = get_settings()

    async def ensure_seeded(self) -> None:
        """Always upsert modules; seed starter questions only when bank is empty."""
        importer = GitImportService(self.db)
        await importer.ensure_modules()
        count = (
            await self.db.execute(select(func.count()).select_from(GitQuestion))
        ).scalar_one()
        if count == 0:
            await self.load_curriculum()

    async def load_curriculum(self) -> int:
        path = Path(self.settings.git_curriculum_path)
        if not path.is_file():
            alt = Path(__file__).resolve().parents[3] / "questions" / "git" / "curriculum.json"
            path = alt if alt.is_file() else path
        if not path.is_file():
            return 0

        importer = GitImportService(self.db)
        topics = await importer.ensure_modules()
        data = json.loads(path.read_text(encoding="utf-8"))
        count = 0
        for q in data.get("questions") or []:
            raw_slug = q["topic"]
            slug = LEGACY_TOPIC_MAP.get(raw_slug, raw_slug)
            topic = topics.get(slug)
            if not topic:
                continue
            qnum = int(q["question_number"])
            stable = q.get("stable_id") or f"{slug}:{qnum:03d}"
            existing = (
                await self.db.execute(
                    select(GitQuestion.id).where(GitQuestion.stable_id == stable)
                )
            ).scalar_one_or_none()
            if existing:
                continue
            etype = normalize_type(q.get("exercise_type") or q.get("mode") or "command")
            diff = normalize_difficulty(q.get("difficulty"))
            solutions = list(q.get("accepted_solutions") or [])
            expected_answer = q.get("expected_answer") or (solutions[0] if solutions else None)
            self.db.add(
                GitQuestion(
                    stable_id=stable,
                    question_number=qnum,
                    topic_id=topic.id,
                    title=q["title"],
                    exercise_type=etype,
                    mode=etype,
                    scenario=q.get("scenario") or "",
                    objective=q.get("objective") or "",
                    task=q["task"],
                    difficulty=diff,
                    concepts=q.get("concepts") or [],
                    tags=q.get("tags") or [],
                    repository_state=q.get("repository_state") or {},
                    expected_state=q.get("expected_state") or {},
                    expected_answer=expected_answer,
                    accepted_solutions=solutions,
                    choices=q.get("choices") or [],
                    allowed_commands=q.get("allowed_commands") or [],
                    hints=q.get("hints") or [],
                    explanation=q.get("explanation") or "",
                    common_mistakes=q.get("common_mistakes") or [],
                    source=q.get("source") or "curriculum.json",
                    source_file=q.get("source_file") or "questions/git/curriculum.json",
                    source_section=q.get("source_section"),
                    sort_order=qnum,
                )
            )
            count += 1
        await self.db.flush()
        return count

    async def list_topics(self, user_id: int) -> List[Dict[str, Any]]:
        await self.ensure_seeded()
        topics = (
            (
                await self.db.execute(
                    select(GitTopic).order_by(GitTopic.sort_order, GitTopic.id)
                )
            )
            .scalars()
            .all()
        )
        out = []
        for t in topics:
            total = (
                await self.db.execute(
                    select(func.count()).select_from(GitQuestion).where(
                        GitQuestion.topic_id == t.id
                    )
                )
            ).scalar_one()
            solved = (
                await self.db.execute(
                    select(func.count())
                    .select_from(GitAttempt)
                    .join(GitQuestion, GitQuestion.id == GitAttempt.question_id)
                    .where(
                        GitAttempt.user_id == user_id,
                        GitAttempt.status == "solved",
                        GitQuestion.topic_id == t.id,
                    )
                )
            ).scalar_one()
            out.append(
                {
                    "id": t.id,
                    "slug": t.slug,
                    "title": t.title,
                    "description": t.description,
                    "sort_order": t.sort_order,
                    "question_count": total,
                    "solved_count": solved,
                }
            )
        return out

    async def list_questions(
        self,
        user_id: int,
        topic: Optional[str] = None,
        difficulty: Optional[str] = None,
        status: Optional[str] = None,
        search: Optional[str] = None,
        exercise_type: Optional[str] = None,
        tag: Optional[str] = None,
        mode: Optional[str] = None,
    ) -> List[Dict[str, Any]]:
        await self.ensure_seeded()
        stmt = (
            select(GitQuestion)
            .options(selectinload(GitQuestion.topic))
            .order_by(GitQuestion.sort_order, GitQuestion.question_number)
        )
        if topic:
            stmt = stmt.join(GitTopic).where(
                (GitTopic.slug == topic) | (GitTopic.title == topic)
            )
        if difficulty:
            stmt = stmt.where(GitQuestion.difficulty == normalize_difficulty(difficulty))
        et = exercise_type or mode
        if et:
            stmt = stmt.where(GitQuestion.exercise_type == normalize_type(et))
        if search:
            like = f"%{search}%"
            stmt = stmt.where(
                GitQuestion.title.ilike(like) | GitQuestion.task.ilike(like)
            )
        if tag:
            stmt = stmt.where(GitQuestion.tags.contains([tag]))

        questions = (await self.db.execute(stmt)).scalars().all()
        attempt_map = await self._attempt_map(user_id)
        out = []
        for q in questions:
            att = attempt_map.get(q.id)
            st = att.status if att else "not_started"
            if status == "completed" and st != "solved":
                continue
            if status == "incorrect" and st != "incorrect":
                continue
            if status == "not_attempted" and st != "not_started":
                continue
            if status and status not in {"completed", "incorrect", "not_attempted"} and st != status:
                continue
            out.append(self._summary(q, att))
        return out

    async def select_question(
        self,
        user_id: int,
        strategy: str = "smart",
        topic: Optional[str] = None,
        difficulty: Optional[str] = None,
        after_id: Optional[int] = None,
    ) -> Optional[Dict[str, Any]]:
        """Pick the next question for Random / Topic / Weak / Review / Sequential."""
        items = await self.list_questions(
            user_id, topic=topic, difficulty=difficulty
        )
        if not items:
            return None

        strategy = (strategy or "smart").lower()
        if strategy == "sequential":
            if after_id:
                later = [q for q in items if q["id"] > after_id]
                return later[0] if later else items[0]
            return items[0]

        if strategy == "review":
            pool = [q for q in items if q["status"] == "solved"]
            return (pool or items)[0] if (pool or items) else None

        if strategy == "review_incorrect" or strategy == "incorrect":
            pool = [q for q in items if q["status"] == "incorrect"]
            return pool[0] if pool else None

        if strategy == "random":
            import random

            unsolved = [q for q in items if q["status"] != "solved"]
            pool = unsolved or items
            return random.choice(pool)

        # smart / weak_areas / topic default
        incorrect = [q for q in items if q["status"] == "incorrect"]
        if incorrect:
            return incorrect[0]
        unattempted = [q for q in items if q["status"] == "not_started"]
        if unattempted:
            return unattempted[0]
        in_progress = [q for q in items if q["status"] == "in_progress"]
        if in_progress:
            return in_progress[0]
        # Fall back to least-attempted solved for spaced review
        return min(items, key=lambda q: q.get("attempt_count") or 0)

    async def get_question(self, user_id: int, question_id: int) -> Optional[Dict[str, Any]]:
        await self.ensure_seeded()
        q = await self._get_question(question_id)
        if not q:
            return None
        att = await self._get_attempt(user_id, q.id)
        detail = self._summary(q, att)
        public_choices = [
            {"key": c.get("key"), "text": c.get("text")}
            for c in (q.choices or [])
            if isinstance(c, dict)
        ]
        detail.update(
            {
                "scenario": q.scenario,
                "objective": q.objective,
                "task": q.task,
                "repository_state": (
                    self.get_session_state(user_id, q.id, q)
                    if (
                        bool(q.repository_state)
                        or (q.exercise_type or q.mode)
                        in {
                            "command",
                            "scenario",
                            "repository_state",
                            "terminal",
                            "multi_step",
                            "debugging",
                        }
                    )
                    else None
                ),
                "allowed_commands": q.allowed_commands or [],
                "hints_available": len(q.hints or []),
                "common_mistakes": q.common_mistakes or [],
                "choices": public_choices,
                "tags": q.tags or [],
                "stable_id": q.stable_id,
            }
        )
        return detail

    def get_session_state(
        self, user_id: int, question_id: int, question: GitQuestion
    ) -> Dict[str, Any]:
        key = (user_id, question_id)
        raw = _sessions.get(key)
        if raw is None:
            raw = dict(question.repository_state or {})
            _sessions[key] = raw
        return state_from_dict(raw).public_view()

    def reset_session(self, user_id: int, question: GitQuestion) -> Dict[str, Any]:
        raw = dict(question.repository_state or {})
        _sessions[(user_id, question.id)] = raw
        return state_from_dict(raw).public_view()

    async def execute(
        self, user_id: int, question_id: int, command: str, reset: bool = False
    ) -> Dict[str, Any]:
        q = await self._get_question(question_id)
        if not q:
            raise ValueError("Question not found")
        if reset:
            self.reset_session(user_id, q)
        key = (user_id, q.id)
        raw = _sessions.get(key) or dict(q.repository_state or {})
        state = state_from_dict(raw)
        result = execute_command(state, command)
        if result.ok:
            # persist raw-ish state by reconstructing from public + files via clone internals
            _sessions[key] = self._persistable(result.state)
        return {
            "ok": result.ok,
            "output": result.output if result.ok else (result.error or ""),
            "error": None if result.ok else result.error,
            "state": result.state.public_view() if result.ok else state_from_dict(raw).public_view(),
        }

    async def attempt(
        self, user_id: int, question_id: int, command: str, hint_index: int = 0
    ) -> Dict[str, Any]:
        q = await self._get_question(question_id)
        if not q:
            raise ValueError("Question not found")

        etype = q.exercise_type or q.mode or "command"
        key = (user_id, q.id)
        raw = _sessions.get(key) or dict(q.repository_state or {})

        if etype in {"command", "scenario", "repository_state", "terminal", "multi_step", "debugging"} and (
            q.expected_state or (command.strip().startswith("git"))
        ):
            # Prefer state evaluation when expected_state present; else answer match
            if q.expected_state:
                eval_result = evaluate_command(
                    initial_state=raw,
                    command=command,
                    expected_state=q.expected_state or {},
                    accepted_solutions=(q.accepted_solutions or [])
                    + ([q.expected_answer] if q.expected_answer else []),
                    explanation=q.explanation or "",
                    hints=q.hints or [],
                    hint_index=hint_index,
                )
                if eval_result.get("state") and eval_result.get("result") != "Command failed":
                    ran = execute_command(state_from_dict(raw), command)
                    if ran.ok:
                        _sessions[key] = self._persistable(ran.state)
            else:
                eval_result = self._grade_answer(q, command, hint_index)
        else:
            eval_result = self._grade_answer(q, command, hint_index)

        att = await self._get_or_create_attempt(user_id, q.id)
        att.attempt_count = (att.attempt_count or 0) + 1
        att.last_command = command
        if eval_result["correct"]:
            att.correct_count = (att.correct_count or 0) + 1
            att.status = "solved"
            if not att.solved_at:
                att.solved_at = datetime.now(timezone.utc)
        else:
            att.incorrect_count = (att.incorrect_count or 0) + 1
            if att.status != "solved":
                att.status = "incorrect"

        sub = GitSubmission(
            attempt_id=att.id,
            command=command,
            correct=bool(eval_result["correct"]),
            feedback=eval_result.get("feedback"),
            resulting_state=eval_result.get("state"),
        )
        self.db.add(sub)
        await self._update_progress(user_id, bool(eval_result["correct"]), hints_delta=0)
        await self.db.flush()

        eval_result["status"] = att.status
        eval_result["attempt_count"] = att.attempt_count
        if eval_result["correct"]:
            eval_result["explanation"] = q.explanation
        return eval_result

    def _grade_answer(
        self, q: GitQuestion, answer: str, hint_index: int
    ) -> Dict[str, Any]:
        """Grade MCQ / text / command-string answers without mutating repo state."""
        normalized = " ".join(answer.strip().split())
        accepted = []
        if q.expected_answer:
            accepted.append(q.expected_answer)
        accepted.extend(q.accepted_solutions or [])
        for c in q.choices or []:
            if isinstance(c, dict) and c.get("correct"):
                if c.get("key"):
                    accepted.append(str(c["key"]))
                if c.get("text"):
                    accepted.append(str(c["text"]))

        correct = False
        for sol in accepted:
            if " ".join(str(sol).strip().split()).lower() == normalized.lower():
                correct = True
                break

        # Soft grade: open-response / conceptual — keyword overlap or substantive answer
        open_response = "open-response" in (q.tags or []) or (
            (q.exercise_type or "") in {"output_interpretation", "scenario"}
            and not any(str(s).strip().lower().startswith("git ") for s in accepted)
        )
        if not correct and open_response and len(normalized) >= 12:
            needles = []
            for sol in accepted:
                needles.extend(re.findall(r"[a-z0-9_-]{3,}", str(sol).lower()))
            needles.extend(c.lower() for c in (q.concepts or []) if len(c) >= 3)
            hits = sum(1 for n in set(needles) if n in normalized.lower())
            if hits >= 1 or len(normalized.split()) >= 8:
                correct = True

        # Prefix match for inferred families like `git commit -m`
        if not correct and normalized.lower().startswith("git "):
            for sol in accepted:
                s = " ".join(str(sol).strip().split()).lower()
                if normalized.lower().startswith(s) or s.startswith(normalized.lower()):
                    correct = True
                    break

        hints = q.hints or []
        next_hint = hints[hint_index] if hint_index < len(hints) else None
        if correct:
            return {
                "correct": True,
                "result": "Correct",
                "output": "",
                "state": {},
                "state_changes": [],
                "feedback": "Nice work — that matches the expected answer.",
                "explanation": q.explanation or None,
                "next_hint": None,
                "concept_tip": None,
            }
        return {
            "correct": False,
            "result": "Incorrect",
            "output": "",
            "state": {},
            "state_changes": [],
            "feedback": (
                "That answer does not match the expected solution.\n\n"
                "Re-read the task and consider which Git concept applies."
            ),
            "explanation": None,
            "next_hint": next_hint,
            "concept_tip": "Compare your answer carefully against the scenario constraints.",
        }

    async def hint(self, user_id: int, question_id: int) -> Dict[str, Any]:
        q = await self._get_question(question_id)
        if not q:
            raise ValueError("Question not found")
        att = await self._get_or_create_attempt(user_id, q.id)
        hints = q.hints or []
        idx = att.hints_used or 0
        if idx >= len(hints):
            # reveal a preferred solution if exhausted
            solution = None
            if q.accepted_solutions:
                solution = q.accepted_solutions[0]
            return {
                "hint_index": idx,
                "hint": "No more conceptual hints. Try inspecting the repo state carefully.",
                "hints_remaining": 0,
                "solution": solution,
            }
        hint = hints[idx]
        att.hints_used = idx + 1
        if att.status == "not_started":
            att.status = "in_progress"
        await self._update_progress(user_id, False, hints_delta=1)
        await self.db.flush()
        return {
            "hint_index": idx,
            "hint": hint,
            "hints_remaining": max(0, len(hints) - (idx + 1)),
            "solution": None,
        }

    async def progress(self, user_id: int) -> Dict[str, Any]:
        await self.ensure_seeded()
        total = (
            await self.db.execute(select(func.count()).select_from(GitQuestion))
        ).scalar_one()
        attempts = (
            (
                await self.db.execute(
                    select(GitAttempt).where(GitAttempt.user_id == user_id)
                )
            )
            .scalars()
            .all()
        )
        solved = sum(1 for a in attempts if a.status == "solved")
        attempt_count = sum(a.attempt_count or 0 for a in attempts)
        hints_used = sum(a.hints_used or 0 for a in attempts)
        correct_subs = (
            await self.db.execute(
                select(func.count())
                .select_from(GitSubmission)
                .join(GitAttempt)
                .where(GitAttempt.user_id == user_id, GitSubmission.correct.is_(True))
            )
        ).scalar_one()
        total_subs = (
            await self.db.execute(
                select(func.count())
                .select_from(GitSubmission)
                .join(GitAttempt)
                .where(GitAttempt.user_id == user_id)
            )
        ).scalar_one()
        accuracy = round((correct_subs / total_subs) * 100, 1) if total_subs else 0.0
        avg_attempts = round(attempt_count / solved, 2) if solved else 0.0

        prog = (
            await self.db.execute(select(GitProgress).where(GitProgress.user_id == user_id))
        ).scalar_one_or_none()
        streak = prog.current_streak if prog else 0
        best = prog.best_streak if prog else 0
        skill = round((solved / total) * 100, 1) if total else 0.0

        topics = await self.list_topics(user_id)
        mastery = [
            {
                "slug": t["slug"],
                "title": t["title"],
                "total": t["question_count"],
                "solved": t["solved_count"],
                "percent": round(
                    (t["solved_count"] / t["question_count"]) * 100, 1
                )
                if t["question_count"]
                else 0.0,
            }
            for t in topics
            if t["question_count"] > 0
        ]

        return {
            "skill_score": skill,
            "solved_count": solved,
            "total_questions": total,
            "accuracy": accuracy,
            "attempt_count": attempt_count,
            "hints_used": hints_used,
            "current_streak": streak,
            "best_streak": best,
            "average_attempts": avg_attempts,
            "topic_mastery": mastery,
            "module_count": len(topics),
            "modules_with_content": len(mastery),
        }

    # ------------------------------------------------------------------
    # helpers
    # ------------------------------------------------------------------

    def _persistable(self, state) -> Dict[str, Any]:
        """Serialize live GitState back into repository_state-shaped dict."""
        commits = [
            {
                "hash": c.hash,
                "message": c.message,
                "parents": list(c.parents),
                "tree": dict(c.tree),
            }
            for c in state.commits.values()
        ]
        staged = []
        head = state.head_tree()
        for path, content in state.index.items():
            committed = head.get(path)
            if content == "__DELETED__":
                if path in head:
                    staged.append({"path": path, "status": "D"})
            elif committed is None:
                staged.append({"path": path, "status": "A", "content": content})
            elif content != committed:
                staged.append({"path": path, "status": "M", "content": content})

        working = []
        for c in state.working_tree_changes():
            entry = {"path": c["path"], "status": c["status"]}
            if c["path"] in state.files:
                entry["content"] = state.files[c["path"]]
            working.append(entry)

        return {
            "repo_name": state.repo_name,
            "initialized": state.initialized,
            "current_branch": state.current_branch,
            "head": state.head,
            "detached": state.detached,
            "branches": dict(state.branches),
            "commits": commits,
            "files": dict(state.files),
            "working_tree": working,
            "staged": staged,
            "untracked": sorted(state.untracked),
            "remotes": dict(state.remotes),
            "tracking": dict(state.tracking),
            "stash": [s.to_dict() for s in state.stash],
            "merge_in_progress": state.merge_in_progress,
            "rebase_in_progress": state.rebase_in_progress,
        }

    async def _get_question(self, question_id: int) -> Optional[GitQuestion]:
        result = await self.db.execute(
            select(GitQuestion)
            .options(selectinload(GitQuestion.topic))
            .where(
                (GitQuestion.id == question_id)
                | (GitQuestion.question_number == question_id)
            )
            .limit(1)
        )
        return result.scalar_one_or_none()

    async def _attempt_map(self, user_id: int) -> Dict[int, GitAttempt]:
        rows = (
            (
                await self.db.execute(
                    select(GitAttempt).where(GitAttempt.user_id == user_id)
                )
            )
            .scalars()
            .all()
        )
        return {a.question_id: a for a in rows}

    async def _get_attempt(self, user_id: int, question_id: int) -> Optional[GitAttempt]:
        result = await self.db.execute(
            select(GitAttempt).where(
                GitAttempt.user_id == user_id, GitAttempt.question_id == question_id
            )
        )
        return result.scalar_one_or_none()

    async def _get_or_create_attempt(self, user_id: int, question_id: int) -> GitAttempt:
        att = await self._get_attempt(user_id, question_id)
        if att:
            return att
        att = GitAttempt(user_id=user_id, question_id=question_id, status="not_started")
        self.db.add(att)
        await self.db.flush()
        return att

    async def _update_progress(
        self, user_id: int, correct: bool, hints_delta: int = 0
    ) -> None:
        prog = (
            await self.db.execute(select(GitProgress).where(GitProgress.user_id == user_id))
        ).scalar_one_or_none()
        if not prog:
            prog = GitProgress(user_id=user_id)
            self.db.add(prog)
            await self.db.flush()
        prog.attempt_count = (prog.attempt_count or 0) + (0 if hints_delta else 1)
        prog.hints_used = (prog.hints_used or 0) + hints_delta
        if correct:
            prog.current_streak = (prog.current_streak or 0) + 1
            prog.best_streak = max(prog.best_streak or 0, prog.current_streak)
        elif not hints_delta:
            prog.current_streak = 0
        # refresh solved_count
        solved = (
            await self.db.execute(
                select(func.count()).select_from(GitAttempt).where(
                    GitAttempt.user_id == user_id, GitAttempt.status == "solved"
                )
            )
        ).scalar_one()
        prog.solved_count = solved
        total = (
            await self.db.execute(select(func.count()).select_from(GitQuestion))
        ).scalar_one()
        prog.skill_score = round((solved / total) * 100, 1) if total else 0.0

    def _summary(self, q: GitQuestion, att: Optional[GitAttempt]) -> Dict[str, Any]:
        return {
            "id": q.id,
            "stable_id": getattr(q, "stable_id", None) or f"legacy:{q.question_number}",
            "question_number": q.question_number,
            "title": q.title,
            "topic": q.topic.title if q.topic else "",
            "topic_slug": q.topic.slug if q.topic else "",
            "difficulty": q.difficulty,
            "mode": q.exercise_type or q.mode,
            "exercise_type": q.exercise_type or q.mode or "command",
            "concepts": q.concepts or [],
            "tags": q.tags or [],
            "status": att.status if att else "not_started",
            "attempt_count": att.attempt_count if att else 0,
            "hints_used": att.hints_used if att else 0,
        }
