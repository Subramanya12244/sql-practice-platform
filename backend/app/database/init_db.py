"""Application startup: create tables, seed default user, load questions."""

from __future__ import annotations

from sqlalchemy import select

from app.config import get_settings
from app.database.session import AppSessionLocal, app_engine
from app.models import Base, User
from app.services.question_service import QuestionService
from app.services.git_lab.schema_migrate import ensure_git_schema


async def init_app_db() -> None:
    settings = get_settings()
    async with app_engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)

    # Additive migrations for Git Lab columns (create_all won't ALTER)
    await ensure_git_schema(app_engine)

    async with AppSessionLocal() as session:
        result = await session.execute(
            select(User).where(User.id == settings.default_user_id)
        )
        user = result.scalar_one_or_none()
        if not user:
            session.add(
                User(
                    id=settings.default_user_id,
                    username=settings.default_user_name,
                    display_name="Local User",
                    current_difficulty="Intermediate",
                )
            )
            await session.commit()

        # Seed questions from local JSON if DB is empty
        from app.models import Question

        count = (await session.execute(select(Question.id).limit(1))).scalar_one_or_none()
        if count is None:
            service = QuestionService(session)
            await service.load_from_local_file()
            await session.commit()

        # Ensure Git modules + seed starter bank if empty
        from app.services.git_lab_service import GitLabService

        git_service = GitLabService(session)
        await git_service.ensure_seeded()
        await session.commit()
