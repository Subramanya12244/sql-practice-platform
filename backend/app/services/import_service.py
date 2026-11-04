"""Import service — orchestrates parse → preview → save."""

from __future__ import annotations

import json
from typing import Any, Dict, List, Optional

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import (
    ChatImport,
    Concept,
    Feedback,
    ImportedAttempt,
    Mistake,
    Question,
    QuestionConcept,
)
from app.parsers.chatgpt_parser import (
    ChatGPTParser,
    ConversationMeta,
    ParsedQuestion,
    ParseResult,
)
from app.schemas.import_schemas import (
    ConfirmImportRequest,
    ConversationSummary,
    ImportSummary,
    PreviewAttempt,
    PreviewQuestion,
    PreviewResponse,
    ScanResponse,
)
from app.utils.difficulty import map_legacy_difficulty


class ImportService:
    def __init__(self, db: AsyncSession) -> None:
        self.db = db
        self.parser = ChatGPTParser()

    # ------------------------------------------------------------------
    # Step 1: Scan conversations
    # ------------------------------------------------------------------

    def scan(self, raw_data: Any) -> ScanResponse:
        metas = self.parser.scan(raw_data)
        summaries = [
            ConversationSummary(
                conversation_id=m.conversation_id,
                title=m.title,
                relevance_score=m.relevance_score,
                message_count=m.message_count,
                sql_block_count=m.sql_block_count,
                q_range_min=m.q_range[0] if m.q_range else None,
                q_range_max=m.q_range[1] if m.q_range else None,
                match_reasons=m.match_reasons,
            )
            for m in metas
        ]
        return ScanResponse(conversations=summaries, total_found=len(summaries))

    # ------------------------------------------------------------------
    # Step 2: Preview (parse, check for duplicates)
    # ------------------------------------------------------------------

    async def preview(
        self,
        raw_data: Any,
        conversation_id: str,
        start_question: int = 59,
    ) -> PreviewResponse:
        result: ParseResult = self.parser.parse(raw_data, conversation_id, start_question)
        meta = result.conversation

        # Check which questions already exist
        q_nums = [q.question_number for q in result.questions]
        if q_nums:
            existing = await self.db.execute(
                select(Question.question_number, Question.id).where(
                    Question.question_number.in_(q_nums)
                )
            )
            existing_map: Dict[int, int] = {row[0]: row[1] for row in existing.all()}
        else:
            existing_map = {}

        preview_questions = [
            self._to_preview(q, existing_map) for q in result.questions
        ]

        q_range = sorted(pq.question_number for pq in preview_questions)
        return PreviewResponse(
            conversation_id=meta.conversation_id,
            conversation_title=meta.title,
            start_question=start_question,
            end_question=q_range[-1] if q_range else None,
            questions=preview_questions,
            total_questions=result.total_attempts,
            total_attempts=result.total_attempts,
            total_feedback=result.total_feedback,
            total_mistakes=result.total_mistakes,
            total_scores=result.total_scores,
            total_concepts=result.total_concepts,
        )

    def _to_preview(
        self, q: ParsedQuestion, existing_map: Dict[int, int]
    ) -> PreviewQuestion:
        return PreviewQuestion(
            question_number=q.question_number,
            question_number_source=q.question_number_source,
            title=q.title,
            business_problem=q.business_problem,
            requirements=q.requirements,
            tables_used=q.tables_used,
            difficulty=q.difficulty,
            topic=q.topic,
            suggested_difficulty=q.suggested_difficulty,
            suggested_topic=q.suggested_topic,
            attempts=[
                PreviewAttempt(
                    attempt_number=a.attempt_number,
                    sql=a.sql,
                    is_correct=a.is_correct,
                    score_text=a.score.score_text if a.score else None,
                    approach_notes=a.approach_notes,
                    feedback_count=len(a.feedbacks),
                    mistake_count=len(a.mistakes),
                )
                for a in q.attempts
            ],
            feedback_count=len(q.feedback),
            mistake_count=len(q.mistakes),
            concept_count=len(q.concepts),
            score_text=q.score.score_text if q.score else None,
            exists_in_db=q.question_number in existing_map,
            db_question_id=existing_map.get(q.question_number),
        )

    # ------------------------------------------------------------------
    # Step 3: Confirm — actually persist
    # ------------------------------------------------------------------

    async def confirm(
        self,
        raw_data: Any,
        request: ConfirmImportRequest,
    ) -> ImportSummary:
        result: ParseResult = self.parser.parse(
            raw_data, request.conversation_id, request.start_question
        )
        meta = result.conversation

        # Build a lookup from the user's action list
        action_map: Dict[int, QuestionImportAction] = {
            qa.question_number: qa for qa in request.questions
        }

        # Check existing questions
        q_nums = [q.question_number for q in result.questions]
        if q_nums:
            existing = await self.db.execute(
                select(Question).where(Question.question_number.in_(q_nums))
            )
            existing_q_map: Dict[int, Question] = {
                q.question_number: q for q in existing.scalars().all()
            }
        else:
            existing_q_map = {}

        # Create ChatImport record
        chat_import = ChatImport(
            filename="conversations.json",
            conversation_id=meta.conversation_id,
            conversation_title=meta.title or "",
            start_question=request.start_question,
            end_question=max(
                (q.question_number for q in result.questions), default=None
            ),
            questions_found=len(result.questions),
            attempts_found=result.total_attempts,
            feedback_found=result.total_feedback,
            mistakes_found=result.total_mistakes,
            scores_found=result.total_scores,
            concepts_found=result.total_concepts,
        )
        self.db.add(chat_import)
        await self.db.flush()

        counts = {
            "new": 0,
            "updated": 0,
            "skipped": 0,
            "attempts": 0,
            "feedback": 0,
            "mistakes": 0,
            "concepts": 0,
        }

        for pq in result.questions:
            action = action_map.get(pq.question_number)
            act = action.action if action else "import"

            if act == "skip":
                counts["skipped"] += 1
                continue

            existing = existing_q_map.get(pq.question_number)

            if existing and act == "import":
                # Default: skip duplicates
                counts["skipped"] += 1
            elif existing and act == "update":
                counts["updated"] += 1
                db_question = existing
                self._apply_overrides(db_question, pq, action, chat_import)
            else:
                # Create new question
                db_question = Question(
                    question_number=pq.question_number,
                    title=(action.title if action and action.title else None)
                    or pq.title
                    or f"Question {pq.question_number}",
                    description=pq.business_problem or "",
                    business_problem=pq.business_problem or "",
                    requirements=(action.requirements if action and action.requirements else None)
                    or pq.requirements,
                    difficulty=map_legacy_difficulty(
                        (action.difficulty if action and action.difficulty else None)
                        or pq.difficulty
                        or "Intermediate"
                    ),
                    topic=(action.topic if action and action.topic else None)
                    or pq.topic
                    or pq.suggested_topic
                    or "SELECT",
                    subtopic=pq.subtopic,
                    tables_used=(action.tables_used if action and action.tables_used else None)
                    or pq.tables_used,
                    reference_query="",
                    expected_columns=[],
                    source_import_id=chat_import.id,
                    source_conversation_id=meta.conversation_id,
                    question_number_source=pq.question_number_source,
                    suggested_difficulty=pq.suggested_difficulty,
                    suggested_topic=pq.suggested_topic,
                    hints=[],
                )
                self.db.add(db_question)
                await self.db.flush()
                counts["new"] += 1

            await self.db.flush()

            if existing and act == "import":
                db_question = existing
            elif existing and act == "update":
                db_question = existing
            # else it was just created

            # Check if we have a db_question at this point
            if existing and act == "import":
                continue

            # Deduplicate imported attempts by source_message_id
            existing_attempt_msg_ids: set[str] = set()
            if existing:
                existing_ia = await self.db.execute(
                    select(ImportedAttempt.source_message_id).where(
                        ImportedAttempt.question_id == db_question.id
                    )
                )
                existing_attempt_msg_ids = {
                    r[0] for r in existing_ia.all() if r[0]
                }

            for att in pq.attempts:
                if att.source_message_id in existing_attempt_msg_ids:
                    continue
                ia = ImportedAttempt(
                    question_id=db_question.id,
                    import_id=chat_import.id,
                    sql=att.sql,
                    attempt_number=att.attempt_number,
                    is_correct=att.is_correct,
                    score=att.score.score if att.score else None,
                    score_max=att.score.max_score if att.score else None,
                    score_text=att.score.score_text if att.score else None,
                    approach_notes=att.approach_notes,
                    source_message_id=att.source_message_id,
                )
                self.db.add(ia)
                await self.db.flush()
                counts["attempts"] += 1

                for fb in att.feedbacks:
                    self.db.add(
                        Feedback(
                            question_id=db_question.id,
                            imported_attempt_id=ia.id,
                            feedback_type=fb.feedback_type,
                            feedback_text=fb.feedback_text,
                            source_message_id=fb.source_message_id,
                        )
                    )
                    counts["feedback"] += 1

                for m in att.mistakes:
                    self.db.add(
                        Mistake(
                            question_id=db_question.id,
                            imported_attempt_id=ia.id,
                            category=m.category,
                            description=m.description,
                            correction=m.correction,
                            source_message_id=m.source_message_id,
                        )
                    )
                    counts["mistakes"] += 1

            # Concepts
            for c in pq.concepts:
                concept_row = await self._get_or_create_concept(c.name, c.description)
                exists_qc = await self.db.execute(
                    select(QuestionConcept).where(
                        QuestionConcept.question_id == db_question.id,
                        QuestionConcept.concept_id == concept_row.id,
                    )
                )
                if not exists_qc.scalar_one_or_none():
                    self.db.add(
                        QuestionConcept(
                            question_id=db_question.id,
                            concept_id=concept_row.id,
                            source_message_id=c.source_message_id,
                        )
                    )
                    counts["concepts"] += 1

        await self.db.flush()

        return ImportSummary(
            questions_new=counts["new"],
            questions_updated=counts["updated"],
            questions_skipped=counts["skipped"],
            attempts_imported=counts["attempts"],
            feedback_imported=counts["feedback"],
            mistakes_imported=counts["mistakes"],
            concepts_imported=counts["concepts"],
            import_id=chat_import.id,
        )

    def _apply_overrides(
        self,
        db_question: Question,
        pq: ParsedQuestion,
        action: Optional[Any],
        chat_import: ChatImport,
    ) -> None:
        if action and action.title:
            db_question.title = action.title
        if action and action.difficulty:
            db_question.difficulty = map_legacy_difficulty(action.difficulty)
        if action and action.topic:
            db_question.topic = action.topic
        if action and action.business_problem:
            db_question.business_problem = action.business_problem
        if action and action.requirements:
            db_question.requirements = action.requirements
        if action and action.tables_used:
            db_question.tables_used = action.tables_used
        # Always update import source
        db_question.source_import_id = chat_import.id
        db_question.source_conversation_id = chat_import.conversation_id

    async def _get_or_create_concept(
        self, name: str, description: Optional[str]
    ) -> Concept:
        result = await self.db.execute(
            select(Concept).where(Concept.name == name)
        )
        concept = result.scalar_one_or_none()
        if concept:
            return concept
        concept = Concept(name=name, description=description)
        self.db.add(concept)
        await self.db.flush()
        return concept

    # ------------------------------------------------------------------
    # Query helpers
    # ------------------------------------------------------------------

    async def get_imported_attempts(
        self, question_id: int
    ) -> List[ImportedAttempt]:
        result = await self.db.execute(
            select(ImportedAttempt)
            .where(ImportedAttempt.question_id == question_id)
            .order_by(ImportedAttempt.attempt_number)
        )
        return list(result.scalars().all())

    async def get_question_feedback(
        self, question_id: int
    ) -> List[Feedback]:
        result = await self.db.execute(
            select(Feedback)
            .where(Feedback.question_id == question_id)
            .order_by(Feedback.created_at)
        )
        return list(result.scalars().all())

    async def get_question_mistakes(
        self, question_id: int
    ) -> List[Mistake]:
        result = await self.db.execute(
            select(Mistake)
            .where(Mistake.question_id == question_id)
            .order_by(Mistake.created_at)
        )
        return list(result.scalars().all())

    async def get_all_mistakes(self) -> List[Dict]:
        result = await self.db.execute(
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
        )
        rows = result.all()
        return [
            {
                "category": r.category,
                "description": r.description,
                "correction": r.correction,
                "question_number": r.question_number,
                "question_title": r.title,
                "created_at": r.created_at.isoformat() if r.created_at else None,
            }
            for r in rows
        ]

    async def get_concepts_with_stats(self) -> List[Dict]:
        result = await self.db.execute(
            select(
                Concept.id,
                Concept.name,
                Concept.description,
            ).order_by(Concept.name)
        )
        concepts = result.all()
        out = []
        for c in concepts:
            qc_result = await self.db.execute(
                select(QuestionConcept.question_id).where(
                    QuestionConcept.concept_id == c.id
                )
            )
            q_ids = [r[0] for r in qc_result.all()]
            out.append(
                {
                    "id": c.id,
                    "name": c.name,
                    "description": c.description,
                    "question_count": len(q_ids),
                }
            )
        return out
