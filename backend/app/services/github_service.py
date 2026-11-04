"""GitHub / local repository sync for Northwind SQL questions.

GitHub (or local clone) = source of truth for question/documentation structure.
App DB = source of truth for practice attempts, scores, mistakes, feedback.

NEVER pushes to GitHub without an explicit confirm call.
Presence of a GitHub question does NOT mean first-attempt correct.
"""

from __future__ import annotations

import base64
from collections import defaultdict
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, List, Optional, Set

import httpx
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import get_settings
from app.models import Attempt, ImportedAttempt, Mistake, Question, Solution
from app.schemas import GitHubSyncResponse
from app.services.question_service import QuestionService
from app.services.repo_parser import (
    folder_for_topic,
    generate_markdown_doc,
    generate_sql_file,
    next_question_number,
    scan_local_repo,
    slugify_title,
)


class GitHubQuestionService:
    def __init__(self, db: AsyncSession) -> None:
        self.db = db
        self.settings = get_settings()
        self.question_service = QuestionService(db)

    def _headers(self) -> Dict[str, str]:
        headers = {
            "Accept": "application/vnd.github+json",
            "X-GitHub-Api-Version": "2022-11-28",
            "User-Agent": "sql-practice-platform",
        }
        if self.settings.github_token:
            headers["Authorization"] = f"Bearer {self.settings.github_token}"
        return headers

    def _local_repo_path(self) -> Optional[Path]:
        raw = self.settings.northwind_repo_path
        if not raw:
            candidates = [
                Path(__file__).resolve().parents[3].parent / "northwind-sql-practice",
                Path.cwd().parent / "northwind-sql-practice",
                Path.cwd().parent.parent / "northwind-sql-practice",
            ]
            for c in candidates:
                if c.exists():
                    return c
            return None
        p = Path(raw)
        return p if p.exists() else None

    # ------------------------------------------------------------------
    # Sync (pull only) — change detection
    # ------------------------------------------------------------------

    async def sync_questions(self) -> GitHubSyncResponse:
        """Pull from local repo / GitHub and upsert docs metadata only.

        Never modifies Attempt / Solution / Mistake / Feedback rows.
        """
        items: List[Dict[str, Any]] = []
        source = "local"

        local = self._local_repo_path()
        if local:
            items = scan_local_repo(local)
            source = "local_repo"
        elif self.settings.github_repository:
            try:
                items = await self._fetch_github_md_sql()
                source = "github"
            except Exception as e:
                count = await self.question_service.load_from_local_file()
                return GitHubSyncResponse(
                    success=count > 0,
                    message=f"GitHub sync failed ({e}). Loaded {count} from questions.json.",
                    questions_synced=count,
                    source="local_fallback",
                )
        else:
            count = await self.question_service.load_from_local_file()
            return GitHubSyncResponse(
                success=count > 0,
                message=f"Loaded {count} questions from local questions.json.",
                questions_synced=count,
                source="local",
            )

        if not items:
            return GitHubSyncResponse(
                success=False,
                message="No questions found in repository.",
                questions_synced=0,
                source=source,
            )

        report = await self._sync_with_change_detection(items)
        report["auto_solved"] = await self.mark_documented_as_solved()
        next_q = next_question_number([q["question_number"] for q in items])
        report["next_question_number"] = next_q
        report["source"] = source
        report["success"] = True
        report["questions_synced"] = (
            report["new"] + report["modified"] + report["unchanged"]
        )
        report["message"] = (
            f"Sync complete ({source}): "
            f"{report['new']} new, {report['modified']} modified, "
            f"{report['deleted']} missing from repo, "
            f"{report['unchanged']} unchanged. "
            f"{report['auto_solved']} documented questions marked SOLVED. "
            f"Next Q = Q{next_q}."
        )
        return GitHubSyncResponse(**report)

    async def mark_documented_as_solved(self) -> int:
        """Questions documented in the repo (.md + .sql) count as already solved.

        Only creates/updates rows whose solved state came from the repo — a
        question solved in the editor keeps its practice history untouched.
        """
        user_id = self.settings.default_user_id
        documented = list(
            (
                await self.db.execute(
                    select(Question).where(Question.github_status == "documented")
                )
            )
            .scalars()
            .all()
        )
        if not documented:
            return 0

        existing = {
            a.question_id: a
            for a in (
                await self.db.execute(
                    select(Attempt).where(Attempt.user_id == user_id)
                )
            )
            .scalars()
            .all()
        }

        now = datetime.now(timezone.utc)
        changed = 0
        for q in documented:
            attempt = existing.get(q.id)
            if attempt is None:
                self.db.add(
                    Attempt(
                        question_id=q.id,
                        user_id=user_id,
                        status="solved",
                        solved_source="github_import",
                        is_correct=True,
                        attempt_count=0,
                        correct_attempts=0,
                        solved_at=now,
                    )
                )
                changed += 1
            elif attempt.status != "solved":
                attempt.status = "solved"
                attempt.solved_source = "github_import"
                attempt.is_correct = True
                attempt.solved_at = attempt.solved_at or now
                changed += 1

        await self.db.flush()
        return changed

    async def _sync_with_change_detection(
        self, items: List[Dict[str, Any]]
    ) -> Dict[str, Any]:
        existing = list((await self.db.execute(select(Question))).scalars().all())
        by_num = {q.question_number: q for q in existing}
        repo_nums: Set[int] = {int(i["question_number"]) for i in items}

        existing_categories = {
            q.folder_category for q in existing if q.folder_category
        }
        new_categories: List[str] = []
        difficulty_changes: List[Dict[str, Any]] = []
        added: List[int] = []
        modified: List[int] = []
        unchanged: List[int] = []
        deleted: List[int] = []
        incomplete: List[Dict[str, Any]] = []

        now = datetime.now(timezone.utc)

        for item in items:
            qnum = int(item["question_number"])
            folder = item.get("folder_category")
            if folder and folder not in existing_categories and folder not in new_categories:
                new_categories.append(folder)

            has_md = bool(item.get("has_md"))
            has_sql = bool(item.get("has_sql"))
            if not (has_md and has_sql):
                incomplete.append(
                    {
                        "question_number": qnum,
                        "missing_md": not has_md,
                        "missing_sql": not has_sql,
                    }
                )

            existing_q = by_num.get(qnum)
            if not existing_q:
                await self.question_service.upsert_from_dicts([item])
                # Reload to set sync timestamp
                result = await self.db.execute(
                    select(Question).where(Question.question_number == qnum)
                )
                created = result.scalar_one()
                created.last_synced_at = now
                created.github_status = item.get("github_status", "documented")
                created.has_md = has_md
                created.has_sql = has_sql
                created.content_hash = item.get("content_hash")
                added.append(qnum)
                continue

            # Detect changes (docs only — never touch practice)
            old_diff = existing_q.difficulty
            new_diff = item.get("difficulty") or old_diff
            hash_changed = (
                item.get("content_hash")
                and existing_q.content_hash
                and item["content_hash"] != existing_q.content_hash
            )
            meta_changed = (
                existing_q.title != item.get("title", existing_q.title)
                or old_diff != new_diff
                or (existing_q.folder_category or "") != (folder or "")
                or existing_q.has_md != has_md
                or existing_q.has_sql != has_sql
                or hash_changed
                or not existing_q.content_hash
            )

            if old_diff != new_diff:
                difficulty_changes.append(
                    {
                        "question_number": qnum,
                        "from": old_diff,
                        "to": new_diff,
                    }
                )

            if meta_changed:
                await self.question_service.upsert_from_dicts([item])
                result = await self.db.execute(
                    select(Question).where(Question.question_number == qnum)
                )
                updated = result.scalar_one()
                updated.last_synced_at = now
                updated.github_status = item.get("github_status", "documented")
                updated.has_md = has_md
                updated.has_sql = has_sql
                updated.content_hash = item.get("content_hash")
                modified.append(qnum)
            else:
                existing_q.last_synced_at = now
                if existing_q.github_status == "missing_from_repo":
                    existing_q.github_status = item.get("github_status", "documented")
                unchanged.append(qnum)

        # Mark questions that were previously from GitHub but are gone
        for q in existing:
            if q.question_number in repo_nums:
                continue
            # Only mark as missing if it had GitHub paths / was documented
            if q.github_md_path or q.github_sql_path or q.github_status in (
                "documented",
                "incomplete",
            ):
                q.github_status = "missing_from_repo"
                deleted.append(q.question_number)

        await self.db.flush()

        return {
            "new": len(added),
            "modified": len(modified),
            "deleted": len(deleted),
            "unchanged": len(unchanged),
            "new_question_numbers": sorted(added),
            "modified_question_numbers": sorted(modified),
            "deleted_question_numbers": sorted(deleted),
            "new_categories": sorted(new_categories),
            "difficulty_changes": difficulty_changes,
            "incomplete_files": incomplete,
            "total_in_repo": len(items),
        }

    async def get_repository_progress(self) -> Dict[str, Any]:
        questions = list((await self.db.execute(select(Question))).scalars().all())
        by_category: Dict[str, int] = defaultdict(int)
        by_difficulty: Dict[str, int] = defaultdict(int)
        documented = 0
        incomplete = 0
        missing = 0
        app_only = 0
        missing_md: List[int] = []
        missing_sql: List[int] = []

        for q in questions:
            cat = q.folder_category or q.topic or "Unknown"
            by_category[cat] += 1
            by_difficulty[q.difficulty] += 1
            status = q.github_status or "app_only"
            if status == "documented":
                documented += 1
            elif status == "incomplete":
                incomplete += 1
                if not q.has_md:
                    missing_md.append(q.question_number)
                if not q.has_sql:
                    missing_sql.append(q.question_number)
            elif status == "missing_from_repo":
                missing += 1
            else:
                app_only += 1

        nums = [q.question_number for q in questions]
        return {
            "total_questions": len(questions),
            "documented": documented,
            "incomplete": incomplete,
            "missing_from_repo": missing,
            "app_only": app_only,
            "by_category": [
                {"category": k, "count": v}
                for k, v in sorted(by_category.items())
            ],
            "by_difficulty": [
                {"difficulty": k, "count": v}
                for k, v in sorted(by_difficulty.items())
            ],
            "missing_md": sorted(missing_md),
            "missing_sql": sorted(missing_sql),
            "next_question_number": next_question_number(nums),
            "max_question_number": max(nums) if nums else None,
            "repository": self.settings.github_repository
            or "local northwind-sql-practice",
        }

    async def _fetch_github_md_sql(self) -> List[Dict[str, Any]]:
        """Download all Q*.md + matching .sql via GitHub git tree API."""
        repo = self.settings.github_repository
        branch = self.settings.github_branch
        async with httpx.AsyncClient(timeout=60.0) as client:
            ref_url = f"https://api.github.com/repos/{repo}/git/ref/heads/{branch}"
            ref_resp = await client.get(ref_url, headers=self._headers())
            ref_resp.raise_for_status()
            sha = ref_resp.json()["object"]["sha"]

            tree_url = (
                f"https://api.github.com/repos/{repo}/git/trees/{sha}?recursive=1"
            )
            tree_resp = await client.get(tree_url, headers=self._headers())
            tree_resp.raise_for_status()
            tree = tree_resp.json().get("tree", [])

            md_files = [
                t
                for t in tree
                if t.get("type") == "blob"
                and t.get("path", "").endswith(".md")
                and "/Q" in t.get("path", "")
                and "Assets" not in t.get("path", "")
            ]

            import re
            import tempfile

            with tempfile.TemporaryDirectory() as tmp:
                root = Path(tmp)
                for entry in md_files:
                    path = entry["path"]
                    name = Path(path).name
                    if not re.match(r"Q\d+", name):
                        continue
                    content = await self._get_file_content(client, repo, path)
                    dest = root / path
                    dest.parent.mkdir(parents=True, exist_ok=True)
                    dest.write_text(content, encoding="utf-8")

                    sql_rel = str(Path(path).with_suffix(".sql"))
                    try:
                        sql_content = await self._get_file_content(client, repo, sql_rel)
                        (root / sql_rel).write_text(sql_content, encoding="utf-8")
                    except Exception:
                        folder = str(Path(path).parent)
                        m = re.match(r"Q0*(\d+)", name)
                        if not m:
                            continue
                        qnum = int(m.group(1))
                        for t in tree:
                            p = t.get("path", "")
                            if (
                                t.get("type") == "blob"
                                and p.startswith(folder + "/")
                                and p.endswith(".sql")
                                and re.match(rf".*/Q0*{qnum}[^0-9]", p)
                            ):
                                try:
                                    sc = await self._get_file_content(client, repo, p)
                                    (root / p).write_text(sc, encoding="utf-8")
                                except Exception:
                                    pass
                                break

                return scan_local_repo(root)

    async def _get_file_content(
        self, client: httpx.AsyncClient, repo: str, path: str
    ) -> str:
        url = f"https://api.github.com/repos/{repo}/contents/{path}"
        params = {"ref": self.settings.github_branch}
        resp = await client.get(url, headers=self._headers(), params=params)
        resp.raise_for_status()
        payload = resp.json()
        content_b64 = payload.get("content", "")
        return base64.b64decode(content_b64).decode("utf-8")

    async def next_q_number(self) -> int:
        result = await self.db.execute(select(func.max(Question.question_number)))
        max_n = result.scalar_one_or_none()
        return next_question_number([max_n] if max_n else [])

    async def preview_docs(self, question_number: int) -> Dict[str, Any]:
        result = await self.db.execute(
            select(Question).where(Question.question_number == question_number)
        )
        question = result.scalar_one_or_none()
        if not question:
            raise ValueError(f"Question Q{question_number} not found")

        wrong_approaches: List[Dict[str, str]] = []
        imported = await self.db.execute(
            select(ImportedAttempt)
            .where(
                ImportedAttempt.question_id == question.id,
                ImportedAttempt.is_correct.is_(False),
            )
            .order_by(ImportedAttempt.attempt_number)
        )
        for att in imported.scalars().all():
            wrong_approaches.append(
                {
                    "sql": att.sql,
                    "note": "Imported incorrect attempt from ChatGPT history.",
                }
            )

        live_wrong = await self.db.execute(
            select(Solution)
            .where(Solution.question_id == question.id, Solution.is_correct.is_(False))
            .order_by(Solution.attempt_number)
        )
        for sol in live_wrong.scalars().all():
            wrong_approaches.append(
                {
                    "sql": sol.sql,
                    "note": f"Platform attempt #{sol.attempt_number} (incorrect).",
                }
            )

        related = list(question.related_question_numbers or [])
        similar = await self.db.execute(
            select(Question).where(
                Question.topic == question.topic,
                Question.question_number != question.question_number,
            )
        )
        for sq in similar.scalars().all():
            shared = set(question.tables_used or []) & set(sq.tables_used or [])
            if shared and sq.question_number not in related:
                related.append(sq.question_number)
        related = sorted(set(related))[:8]

        folder = question.folder_category or folder_for_topic(question.topic)
        slug = slugify_title(question.title)
        md_path = question.github_md_path or f"{folder}/Q{question_number}_{slug}.md"
        sql_path = (
            question.github_sql_path or f"{folder}/Q{question_number}_{slug}.sql"
        )

        payload = {
            "question_number": question.question_number,
            "title": question.title,
            "difficulty": question.difficulty,
            "topic": question.topic,
            "subtopic": question.subtopic,
            "business_problem": question.business_problem,
            "objective": question.objective or question.description,
            "tables_used": question.tables_used or [],
            "expected_columns": question.expected_columns or [],
            "expected_output": question.expected_output or "",
            "concepts_used": question.concepts_used or [],
            "why_this_approach": question.why_this_approach or "",
            "common_mistakes": question.common_mistakes or [],
            "interview_followups": question.interview_followups or [],
            "learning_outcomes": question.learning_outcomes or [],
            "reference_query": question.reference_query or "",
            "wrong_approaches": wrong_approaches,
            "related_question_numbers": related,
        }

        return {
            "question_number": question_number,
            "md_path": md_path,
            "sql_path": sql_path,
            "markdown": generate_markdown_doc(payload),
            "sql": generate_sql_file(payload),
            "will_push": False,
            "message": (
                "Preview only. Nothing was pushed to GitHub. "
                "Call confirm to write locally or push with your approval."
            ),
        }

    async def write_docs_local(
        self,
        question_number: int,
        *,
        also_push: bool = False,
        markdown: Optional[str] = None,
        sql: Optional[str] = None,
    ) -> Dict[str, Any]:
        preview = await self.preview_docs(question_number)
        md_content = markdown if markdown is not None else preview["markdown"]
        sql_content = sql if sql is not None else preview["sql"]
        local = self._local_repo_path()
        if not local:
            raise ValueError(
                "NORTHWIND_REPO_PATH is not set / local northwind-sql-practice not found."
            )

        md_rel = preview["md_path"]
        sql_rel = preview["sql_path"]
        md_abs = local / md_rel
        sql_abs = local / sql_rel
        md_abs.parent.mkdir(parents=True, exist_ok=True)
        md_abs.write_text(md_content, encoding="utf-8")
        sql_abs.write_text(sql_content.rstrip() + "\n", encoding="utf-8")

        result = await self.db.execute(
            select(Question).where(Question.question_number == question_number)
        )
        question = result.scalar_one_or_none()
        if question:
            question.github_md_path = md_rel
            question.github_sql_path = sql_rel
            question.has_md = True
            question.has_sql = True
            question.github_status = "documented"
            # Keep grading reference in sync when the user edits the .sql in preview
            if sql is not None and sql.strip():
                question.reference_query = sql.strip()
            await self.db.flush()

        push_result = None
        push_skipped_reason: Optional[str] = None
        if also_push:
            if not self.settings.github_token or not self.settings.github_repository:
                push_skipped_reason = (
                    "Push skipped — set GITHUB_TOKEN and GITHUB_REPOSITORY in .env, "
                    "then restart the backend."
                )
            else:
                push_result = await self._push_files(
                    [
                        {"path": md_rel, "content": md_content},
                        {"path": sql_rel, "content": sql_content.rstrip() + "\n"},
                    ],
                    message=f"docs: Q{question_number} — {question.title if question else ''}",
                )

        if push_result:
            message = f"Wrote Q{question_number} docs locally and pushed to GitHub."
        elif push_skipped_reason:
            message = f"Wrote Q{question_number} docs locally. {push_skipped_reason}"
        elif also_push:
            message = f"Wrote Q{question_number} docs locally. Push did not complete."
        else:
            message = f"Wrote Q{question_number} docs locally. Not pushed."

        return {
            "success": True,
            "md_path": str(md_abs),
            "sql_path": str(sql_abs),
            "pushed": bool(push_result),
            "push_result": push_result,
            "message": message,
        }

    async def _push_files(
        self, files: List[Dict[str, str]], message: str
    ) -> Dict[str, Any]:
        repo = self.settings.github_repository
        branch = self.settings.github_branch
        results = []
        async with httpx.AsyncClient(timeout=60.0) as client:
            for f in files:
                path = f["path"]
                content_b64 = base64.b64encode(f["content"].encode("utf-8")).decode()
                get_url = f"https://api.github.com/repos/{repo}/contents/{path}"
                existing = await client.get(
                    get_url,
                    headers=self._headers(),
                    params={"ref": branch},
                )
                sha = None
                if existing.status_code == 200:
                    sha = existing.json().get("sha")

                body: Dict[str, Any] = {
                    "message": message,
                    "content": content_b64,
                    "branch": branch,
                }
                if sha:
                    body["sha"] = sha

                put = await client.put(
                    get_url, headers=self._headers(), json=body
                )
                put.raise_for_status()
                results.append({"path": path, "status": put.status_code})
        return {"files": results, "message": message}
