"""Markdown import pipeline for the Git question bank."""

from __future__ import annotations

import uuid
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import GitImport, GitQuestion, GitTopic
from app.services.git_lab.curriculum import GIT_MODULES, LEGACY_TOPIC_MAP, slugify_module
from app.services.git_lab.markdown_parser import ParsedExercise, parse_git_markdown

# preview_id -> payload
_preview_store: Dict[str, Dict[str, Any]] = {}


class GitImportService:
    def __init__(self, db: AsyncSession) -> None:
        self.db = db

    async def ensure_modules(self) -> Dict[str, GitTopic]:
        """Upsert the full 25-module curriculum; return slug → topic."""
        existing = {
            t.slug: t
            for t in (await self.db.execute(select(GitTopic))).scalars().all()
        }
        for m in GIT_MODULES:
            if m["slug"] in existing:
                topic = existing[m["slug"]]
                topic.title = m["title"]
                topic.description = m["description"]
                topic.sort_order = m["sort_order"]
            else:
                topic = GitTopic(
                    slug=m["slug"],
                    title=m["title"],
                    description=m["description"],
                    sort_order=m["sort_order"],
                )
                self.db.add(topic)
                await self.db.flush()
                existing[m["slug"]] = topic
        await self.db.flush()
        return existing

    def preview_markdown(self, text: str, filename: str) -> Dict[str, Any]:
        parsed = parse_git_markdown(text, filename=filename)
        return self._build_preview(parsed.exercises, parsed.modules, filename, text)

    async def enrich_preview_with_db(self, preview: Dict[str, Any]) -> Dict[str, Any]:
        """Mark duplicates against existing stable_ids / titles."""
        stable_ids = [e["stable_id"] for e in preview["exercises"]]
        existing_rows = (
            (
                await self.db.execute(
                    select(GitQuestion.stable_id, GitQuestion.title, GitQuestion.id).where(
                        GitQuestion.stable_id.in_(stable_ids) if stable_ids else False
                    )
                )
            )
            .all()
            if stable_ids
            else []
        )
        existing_map = {r.stable_id: r for r in existing_rows}

        # Also detect title collisions within same module
        titles = (
            await self.db.execute(select(GitQuestion.title, GitQuestion.stable_id))
        ).all()
        title_set = {(t.title.strip().lower(), t.stable_id) for t in titles}

        dup_count = 0
        for ex in preview["exercises"]:
            issues = list(ex.get("issues") or [])
            if ex["stable_id"] in existing_map:
                issues.append(
                    {
                        "level": "duplicate",
                        "message": f"Already in bank as id={existing_map[ex['stable_id']].id}",
                    }
                )
                dup_count += 1
                ex["is_duplicate"] = True
            else:
                ex["is_duplicate"] = False
                for title, sid in title_set:
                    if title == ex["title"].strip().lower() and sid != ex["stable_id"]:
                        issues.append(
                            {
                                "level": "warning",
                                "message": f"Similar title already exists ({sid})",
                            }
                        )
            ex["issues"] = issues

        preview["counts"]["duplicates"] = dup_count
        preview["counts"]["valid"] = sum(
            1
            for e in preview["exercises"]
            if not any(i["level"] == "error" for i in e.get("issues") or [])
            and not e.get("is_duplicate")
        )
        preview["counts"]["errors"] = sum(
            1
            for e in preview["exercises"]
            if any(i["level"] == "error" for i in e.get("issues") or [])
        )
        preview["counts"]["warnings"] = sum(
            1
            for e in preview["exercises"]
            if any(i["level"] == "warning" for i in e.get("issues") or [])
        )
        return preview

    def _build_preview(
        self,
        exercises: List[ParsedExercise],
        modules: List[Dict[str, str]],
        filename: str,
        text: str,
    ) -> Dict[str, Any]:
        preview_id = str(uuid.uuid4())
        items = []
        by_diff: Dict[str, int] = {}
        by_type: Dict[str, int] = {}
        for ex in exercises:
            by_diff[ex.difficulty] = by_diff.get(ex.difficulty, 0) + 1
            by_type[ex.exercise_type] = by_type.get(ex.exercise_type, 0) + 1
            issues = [{"level": "error", "message": e} for e in ex.errors]
            issues += [{"level": "warning", "message": w} for w in ex.warnings]
            items.append(
                {
                    **ex.to_dict(),
                    "issues": issues,
                    "is_duplicate": False,
                }
            )

        payload = {
            "preview_id": preview_id,
            "filename": filename,
            "modules": modules,
            "exercises": items,
            "counts": {
                "total": len(items),
                "modules": len(modules),
                "valid": sum(1 for e in items if not e["errors"]),
                "warnings": sum(1 for e in items if e["warnings"]),
                "errors": sum(1 for e in items if e["errors"]),
                "duplicates": 0,
            },
            "by_difficulty": by_diff,
            "by_type": by_type,
            "_raw_text": text,
        }
        _preview_store[preview_id] = payload
        # Public view without raw text dump of every field duplication
        public = {k: v for k, v in payload.items() if k != "_raw_text"}
        # Strip heavy state from list view? Keep for review — OK for hundreds.
        return public

    async def confirm_import(
        self,
        preview_id: str,
        user_id: int,
        skip_duplicates: bool = True,
        import_valid_only: bool = True,
    ) -> Dict[str, Any]:
        payload = _preview_store.get(preview_id)
        if not payload:
            raise ValueError("Preview expired or not found. Re-upload the Markdown file.")

        topics = await self.ensure_modules()
        next_num = (
            await self.db.execute(select(func.coalesce(func.max(GitQuestion.question_number), 0)))
        ).scalar_one()

        imported = 0
        skipped = 0
        failed = 0
        duplicates = 0
        modules_touched: set[str] = set()

        for ex in payload["exercises"]:
            has_error = any(i["level"] == "error" for i in ex.get("issues") or [])
            is_dup = bool(ex.get("is_duplicate"))
            if is_dup:
                duplicates += 1
                if skip_duplicates:
                    skipped += 1
                    continue
            if has_error and import_valid_only:
                failed += 1
                continue

            slug = ex["module_slug"]
            # Map into known curriculum when possible
            slug = LEGACY_TOPIC_MAP.get(slug, slug)
            topic = topics.get(slug)
            if not topic:
                # Create ad-hoc module from markdown
                topic = GitTopic(
                    slug=slug,
                    title=ex["module_title"],
                    description="Imported from Markdown",
                    sort_order=1000 + len(topics),
                )
                self.db.add(topic)
                await self.db.flush()
                topics[slug] = topic

            # Re-check duplicate in DB at confirm time
            existing = (
                await self.db.execute(
                    select(GitQuestion).where(GitQuestion.stable_id == ex["stable_id"])
                )
            ).scalar_one_or_none()
            if existing:
                duplicates += 1
                skipped += 1
                continue

            next_num += 1
            solutions = list(ex.get("accepted_solutions") or [])
            expected_answer = ex.get("expected_answer") or (solutions[0] if solutions else None)
            if expected_answer and expected_answer not in solutions:
                solutions = [expected_answer] + solutions

            tags = list(ex.get("tags") or [])
            if ex.get("open_response") and "open-response" not in tags:
                tags.append("open-response")

            q = GitQuestion(
                stable_id=ex["stable_id"],
                question_number=next_num,
                topic_id=topic.id,
                title=ex["title"],
                exercise_type=ex["exercise_type"],
                mode=ex["exercise_type"],
                scenario=ex.get("scenario") or "",
                objective=ex.get("objective") or "",
                task=ex["task"],
                difficulty=ex["difficulty"],
                concepts=ex.get("concepts") or [],
                tags=tags,
                repository_state=ex.get("repository_state") or {},
                expected_state=ex.get("expected_state") or {},
                expected_answer=expected_answer,
                accepted_solutions=solutions,
                choices=ex.get("choices") or [],
                allowed_commands=[],
                hints=ex.get("hints") or [],
                explanation=ex.get("explanation") or "",
                common_mistakes=ex.get("common_mistakes") or [],
                source="markdown_import",
                source_file=payload["filename"],
                source_section=ex.get("source_section") or "",
                sort_order=next_num,
            )
            self.db.add(q)
            imported += 1
            modules_touched.add(topic.slug)

        record = GitImport(
            filename=payload["filename"],
            imported_at=datetime.now(timezone.utc),
            total_questions=payload["counts"]["total"],
            imported_count=imported,
            skipped_count=skipped,
            failed_count=failed,
            duplicate_count=duplicates,
            warning_count=payload["counts"].get("warnings") or 0,
            modules_touched=sorted(modules_touched),
            report={
                "by_difficulty": payload.get("by_difficulty"),
                "by_type": payload.get("by_type"),
                "preview_id": preview_id,
            },
            status="completed",
            user_id=user_id,
        )
        self.db.add(record)
        await self.db.flush()
        _preview_store.pop(preview_id, None)

        return {
            "import_id": record.id,
            "filename": record.filename,
            "total_questions": record.total_questions,
            "imported": imported,
            "skipped": skipped,
            "failed": failed,
            "duplicates": duplicates,
            "modules_touched": sorted(modules_touched),
        }

    async def list_imports(self, limit: int = 50) -> List[Dict[str, Any]]:
        rows = (
            (
                await self.db.execute(
                    select(GitImport).order_by(GitImport.imported_at.desc()).limit(limit)
                )
            )
            .scalars()
            .all()
        )
        return [
            {
                "id": r.id,
                "filename": r.filename,
                "imported_at": r.imported_at.isoformat() if r.imported_at else None,
                "total_questions": r.total_questions,
                "imported_count": r.imported_count,
                "skipped_count": r.skipped_count,
                "failed_count": r.failed_count,
                "duplicate_count": r.duplicate_count,
                "warning_count": r.warning_count,
                "modules_touched": r.modules_touched or [],
                "status": r.status,
            }
            for r in rows
        ]
