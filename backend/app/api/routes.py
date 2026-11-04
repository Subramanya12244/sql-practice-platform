"""API route modules."""

from fastapi import APIRouter, Depends, File, HTTPException, Query, UploadFile
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import get_settings
from app.database.session import get_app_db
from app.schemas import (
    AttemptHistoryItem,
    AttemptHistoryResponse,
    ExecuteQueryRequest,
    ExecuteQueryResponse,
    GitHubDocsConfirmRequest,
    GitHubDocsConfirmResponse,
    GitHubDocsPreview,
    GitHubSyncResponse,
    NextQuestionNumberResponse,
    ProgressResponse,
    MarkdownParseRequest,
    MarkdownParseResponse,
    QuestionCreateRequest,
    QuestionCreateResponse,
    QuestionDeleteResponse,
    QuestionListResponse,
    QuestionPublic,
    SchemaResponse,
    SetReferenceRequest,
    SetReferenceResponse,
    SubmitRequest,
    SubmitResponse,
    TopicsResponse,
    TopicItem,
)
from app.services.github_service import GitHubQuestionService
from app.services.progress_service import ProgressService
from app.services.query_executor import QueryExecutor
from app.services.question_service import QuestionService
from app.services.schema_service import SchemaService
from app.services.submission_service import SubmissionService

router = APIRouter(prefix="/api")
settings = get_settings()


def _user_id() -> int:
    return settings.default_user_id


# ---------------------------------------------------------------------------
# Questions
# ---------------------------------------------------------------------------


@router.get("/questions", response_model=QuestionListResponse)
async def list_questions(
    difficulty: str | None = None,
    topic: str | None = None,
    status: str | None = None,
    search: str | None = None,
    db: AsyncSession = Depends(get_app_db),
):
    service = QuestionService(db)
    questions, total = await service.list_questions(
        user_id=_user_id(),
        difficulty=difficulty,
        topic=topic,
        status=status,
        search=search,
    )
    return QuestionListResponse(questions=questions, total=total)


@router.post("/questions", response_model=QuestionCreateResponse, status_code=201)
async def create_question(
    body: QuestionCreateRequest, db: AsyncSession = Depends(get_app_db)
):
    service = QuestionService(db)
    try:
        question = await service.create_question(body.model_dump())
    except ValueError as e:
        detail = str(e)
        status = 409 if "already exists" in detail.lower() else 400
        raise HTTPException(status_code=status, detail=detail) from e

    shift = service.consume_create_shift()
    if shift:
        md_num, shifted_to, old_title = shift
        message = (
            f"Created Q{question.question_number} from markdown. "
            f"Existing “{old_title}” was moved Q{md_num} → Q{shifted_to} so the "
            "markdown number could be kept. It is unsolved until you submit a correct query."
        )
    else:
        message = (
            f"Created Q{question.question_number}. It is unsolved until you submit a "
            "correct query. Use Document to GitHub when you want the .md/.sql files."
        )

    return QuestionCreateResponse(
        success=True,
        question_id=question.id,
        question_number=question.question_number,
        title=question.title,
        status="not_started",
        message=message,
        shifted_question_number=shift[1] if shift else None,
        shifted_from_number=shift[0] if shift else None,
        shifted_title=shift[2] if shift else None,
    )


@router.post("/questions/parse-markdown", response_model=MarkdownParseResponse)
async def parse_question_markdown(body: MarkdownParseRequest):
    """Extract question fields from a pasted .md (northwind-sql-practice format)."""
    from app.services.repo_parser import parse_markdown

    filename = body.filename or ""
    folder = ""
    if "/" in filename.replace("\\", "/"):
        folder = filename.replace("\\", "/").rsplit("/", 1)[0].split("/")[-1]

    parsed = parse_markdown(body.markdown, folder=folder, md_path=filename)

    fields_found = [
        name
        for name, value in [
            ("title", parsed.get("title")),
            ("topic", parsed.get("topic")),
            ("difficulty", parsed.get("difficulty")),
            ("business_problem", parsed.get("business_problem")),
            ("objective", parsed.get("objective")),
            ("tables_used", parsed.get("tables_used")),
            ("expected_columns", parsed.get("expected_columns")),
            ("expected_output", parsed.get("expected_output")),
            ("concepts_used", parsed.get("concepts_used")),
            ("common_mistakes", parsed.get("common_mistakes")),
            ("why_this_approach", parsed.get("why_this_approach")),
            ("interview_followups", parsed.get("interview_followups")),
            ("learning_outcomes", parsed.get("learning_outcomes")),
            ("reference_query", parsed.get("reference_query")),
            ("question_number", parsed.get("question_number")),
        ]
        if value
    ]

    return MarkdownParseResponse(
        success=bool(parsed.get("title") or parsed.get("business_problem")),
        message=(
            f"Extracted {len(fields_found)} fields from the markdown."
            if fields_found
            else "Could not extract fields — check the markdown format."
        ),
        title=parsed.get("title") or "",
        topic=parsed.get("topic") or "",
        difficulty=parsed.get("difficulty") or "Intermediate",
        business_problem=parsed.get("business_problem") or "",
        objective=parsed.get("objective") or "",
        tables_used=parsed.get("tables_used") or [],
        expected_output=parsed.get("expected_output") or "",
        expected_columns=parsed.get("expected_columns") or [],
        requirements=parsed.get("requirements") or [],
        concepts_used=parsed.get("concepts_used") or [],
        common_mistakes=parsed.get("common_mistakes") or [],
        why_this_approach=parsed.get("why_this_approach") or "",
        interview_followups=parsed.get("interview_followups") or [],
        learning_outcomes=parsed.get("learning_outcomes") or [],
        folder_category=parsed.get("folder_category"),
        subtopic=parsed.get("subtopic"),
        question_number=parsed.get("question_number"),
        reference_query=parsed.get("reference_query") or "",
        related_question_numbers=parsed.get("related_question_numbers") or [],
        fields_found=fields_found,
    )


@router.post("/questions/parse-markdown/upload", response_model=MarkdownParseResponse)
async def parse_question_markdown_upload(
    file: UploadFile = File(...),
    sql_file: UploadFile | None = File(None),
):
    """Upload a .md (and optional .sql) and extract question fields."""
    from app.services.repo_parser import extract_sql, parse_markdown

    name = file.filename or "question.md"
    if not name.lower().endswith((".md", ".markdown", ".txt")):
        raise HTTPException(
            status_code=400,
            detail="Upload a .md / .markdown / .txt file.",
        )
    raw = (await file.read()).decode("utf-8", errors="replace")
    if len(raw.strip()) < 10:
        raise HTTPException(status_code=400, detail="Markdown file is empty.")

    folder = ""
    if "/" in name.replace("\\", "/"):
        folder = name.replace("\\", "/").rsplit("/", 1)[0].split("/")[-1]

    parsed = parse_markdown(raw, folder=folder, md_path=name)
    reference = parsed.get("reference_query") or ""

    if sql_file is not None and sql_file.filename:
        sql_raw = (await sql_file.read()).decode("utf-8", errors="replace")
        cleaned = extract_sql(sql_raw)
        if cleaned:
            reference = cleaned

    fields_found = [
        name
        for name, value in [
            ("title", parsed.get("title")),
            ("topic", parsed.get("topic")),
            ("difficulty", parsed.get("difficulty")),
            ("business_problem", parsed.get("business_problem")),
            ("objective", parsed.get("objective")),
            ("tables_used", parsed.get("tables_used")),
            ("expected_columns", parsed.get("expected_columns")),
            ("expected_output", parsed.get("expected_output")),
            ("concepts_used", parsed.get("concepts_used")),
            ("common_mistakes", parsed.get("common_mistakes")),
            ("why_this_approach", parsed.get("why_this_approach")),
            ("interview_followups", parsed.get("interview_followups")),
            ("learning_outcomes", parsed.get("learning_outcomes")),
            ("reference_query", reference),
            ("question_number", parsed.get("question_number")),
        ]
        if value
    ]

    return MarkdownParseResponse(
        success=bool(parsed.get("title") or parsed.get("business_problem")),
        message=(
            f"Extracted {len(fields_found)} fields from {name}."
            if fields_found
            else "Could not extract fields — check the markdown format."
        ),
        title=parsed.get("title") or "",
        topic=parsed.get("topic") or "",
        difficulty=parsed.get("difficulty") or "Intermediate",
        business_problem=parsed.get("business_problem") or "",
        objective=parsed.get("objective") or "",
        tables_used=parsed.get("tables_used") or [],
        expected_output=parsed.get("expected_output") or "",
        expected_columns=parsed.get("expected_columns") or [],
        requirements=parsed.get("requirements") or [],
        concepts_used=parsed.get("concepts_used") or [],
        common_mistakes=parsed.get("common_mistakes") or [],
        why_this_approach=parsed.get("why_this_approach") or "",
        interview_followups=parsed.get("interview_followups") or [],
        learning_outcomes=parsed.get("learning_outcomes") or [],
        folder_category=parsed.get("folder_category"),
        subtopic=parsed.get("subtopic"),
        question_number=parsed.get("question_number"),
        reference_query=reference,
        related_question_numbers=parsed.get("related_question_numbers") or [],
        fields_found=fields_found,
    )


@router.get("/questions/{question_id}", response_model=QuestionPublic)
async def get_question(question_id: int, db: AsyncSession = Depends(get_app_db)):
    service = QuestionService(db)
    question = await service.get_question_public(question_id, _user_id())
    if not question:
        raise HTTPException(status_code=404, detail="Question not found")
    return question


@router.delete("/questions/{question_id}", response_model=QuestionDeleteResponse)
async def delete_question(
    question_id: int, db: AsyncSession = Depends(get_app_db)
):
    """Delete a question and related practice/import data from the app DB."""
    service = QuestionService(db)
    try:
        result = await service.delete_question(question_id)
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e)) from e
    return QuestionDeleteResponse(**result)


@router.put("/questions/{question_id}/reference", response_model=SetReferenceResponse)
async def set_question_reference(
    question_id: int,
    body: SetReferenceRequest,
    db: AsyncSession = Depends(get_app_db),
):
    """Attach or replace the hidden grading reference SQL for a question."""
    from sqlalchemy import select

    from app.models import Question
    from app.services.query_executor import QueryExecutor

    sql = body.sql.strip()
    if not sql:
        raise HTTPException(status_code=400, detail="Reference SQL cannot be empty.")

    question = await db.get(Question, question_id)
    if not question:
        result = await db.execute(
            select(Question).where(Question.question_number == question_id)
        )
        question = result.scalar_one_or_none()
    if not question:
        raise HTTPException(status_code=404, detail="Question not found")

    # Validate it runs against the practice DB (or leave project DBs for later)
    check = await QueryExecutor().execute(sql, for_evaluation=True)
    if not check.success:
        raise HTTPException(
            status_code=400,
            detail=(
                "Reference SQL failed to run — fix it before saving. "
                f"{check.message or check.error_type or ''}"
            ).strip(),
        )

    question.reference_query = sql
    question.has_sql = True
    if check.columns:
        question.expected_columns = list(check.columns)
    await db.flush()

    return SetReferenceResponse(
        success=True,
        question_number=question.question_number,
        has_reference_query=True,
        message=(
            f"Reference SQL saved for Q{question.question_number}. "
            "Submit can now grade answers against it."
        ),
    )


@router.get("/questions/{question_id}/attempts", response_model=AttemptHistoryResponse)
async def get_attempts(question_id: int, db: AsyncSession = Depends(get_app_db)):
    service = SubmissionService(db)
    solutions = await service.get_attempt_history(question_id, _user_id())
    items = [
        AttemptHistoryItem(
            attempt_number=s.attempt_number,
            is_correct=s.is_correct,
            sql=s.sql,
            execution_time_ms=s.execution_time_ms,
            row_count=s.row_count,
            created_at=s.created_at,
        )
        for s in solutions
    ]
    return AttemptHistoryResponse(attempts=items, total=len(items))


@router.post("/questions/{question_id}/submit", response_model=SubmitResponse)
async def submit_answer(
    question_id: int,
    body: SubmitRequest,
    db: AsyncSession = Depends(get_app_db),
):
    service = SubmissionService(db)
    return await service.submit(question_id, body.sql, _user_id())


# ---------------------------------------------------------------------------
# Query execution
# ---------------------------------------------------------------------------


@router.post("/query/execute", response_model=ExecuteQueryResponse)
async def execute_query(
    body: ExecuteQueryRequest, db: AsyncSession = Depends(get_app_db)
):
    from app.api.project_routes import _resolve_database_url

    url = await _resolve_database_url(db, body.project_id)
    executor = QueryExecutor(url)
    result = await executor.execute(body.sql)
    return ExecuteQueryResponse(
        success=result.success,
        execution_time_ms=result.execution_time_ms,
        row_count=result.row_count,
        columns=result.columns,
        rows=result.rows,
        error_type=result.error_type,
        message=result.message,
        truncated=result.truncated,
    )


# ---------------------------------------------------------------------------
# Progress / topics / schema
# ---------------------------------------------------------------------------


@router.get("/progress", response_model=ProgressResponse)
async def get_progress(db: AsyncSession = Depends(get_app_db)):
    service = ProgressService(db)
    progress = await service.get_progress(_user_id())
    gh = GitHubQuestionService(db)
    repo = await gh.get_repository_progress()
    from app.schemas import RepositoryProgress

    progress.repository = RepositoryProgress(**repo)
    return progress


@router.get("/progress/repository", response_model=None)
async def get_repository_progress(db: AsyncSession = Depends(get_app_db)):
    from app.schemas import RepositoryProgress

    gh = GitHubQuestionService(db)
    return RepositoryProgress(**(await gh.get_repository_progress()))


@router.get("/topics", response_model=TopicsResponse)
async def get_topics(db: AsyncSession = Depends(get_app_db)):
    service = QuestionService(db)
    topics = await service.get_topics()
    return TopicsResponse(topics=[TopicItem(**t) for t in topics])


@router.get("/schema", response_model=SchemaResponse)
async def get_schema(
    tables: str | None = Query(None, description="Comma-separated table names"),
    project_id: int | None = None,
    db: AsyncSession = Depends(get_app_db),
):
    from app.api.project_routes import _resolve_database_url

    service = SchemaService(await _resolve_database_url(db, project_id))
    table_list = [t.strip() for t in tables.split(",") if t.strip()] if tables else None
    try:
        return await service.get_schema(table_list)
    except Exception as e:
        raise HTTPException(status_code=503, detail=f"Schema unavailable: {e}") from e


# ---------------------------------------------------------------------------
# GitHub sync
# ---------------------------------------------------------------------------


@router.post("/github/sync", response_model=GitHubSyncResponse)
async def github_sync(db: AsyncSession = Depends(get_app_db)):
    service = GitHubQuestionService(db)
    return await service.sync_questions()


@router.get("/github/next-number", response_model=NextQuestionNumberResponse)
async def github_next_number(db: AsyncSession = Depends(get_app_db)):
    service = GitHubQuestionService(db)
    nxt = await service.next_q_number()
    from sqlalchemy import func, select
    from app.models import Question

    max_n = (
        await db.execute(select(func.max(Question.question_number)))
    ).scalar_one_or_none()
    return NextQuestionNumberResponse(next_question_number=nxt, max_existing=max_n)


@router.get("/github/docs/{question_number}/preview", response_model=GitHubDocsPreview)
async def preview_github_docs(
    question_number: int, db: AsyncSession = Depends(get_app_db)
):
    """Generate .md + .sql preview. Never pushes."""
    service = GitHubQuestionService(db)
    try:
        data = await service.preview_docs(question_number)
        return GitHubDocsPreview(**data)
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e)) from e


@router.post("/github/docs/confirm", response_model=GitHubDocsConfirmResponse)
async def confirm_github_docs(
    body: GitHubDocsConfirmRequest,
    db: AsyncSession = Depends(get_app_db),
):
    """Write docs locally. Push to GitHub only when push_to_github=true (explicit)."""
    service = GitHubQuestionService(db)
    try:
        result = await service.write_docs_local(
            body.question_number,
            also_push=body.push_to_github,
            markdown=body.markdown,
            sql=body.sql,
        )
        return GitHubDocsConfirmResponse(
            success=result["success"],
            message=result["message"],
            md_path=result["md_path"],
            sql_path=result["sql_path"],
            pushed=result["pushed"],
        )
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e)) from e
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Docs write failed: {e}") from e
