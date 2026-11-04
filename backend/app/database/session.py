"""Database engine and session factories.

Two separate databases:
- practice_engine: Northwind tables (read-only user for query execution)
- app_engine: questions, attempts, solutions, progress
"""

from collections.abc import AsyncGenerator

from sqlalchemy.ext.asyncio import (
    AsyncSession,
    async_sessionmaker,
    create_async_engine,
)

from app.config import get_settings

settings = get_settings()

practice_engine = create_async_engine(
    settings.database_url,
    echo=False,
    pool_pre_ping=True,
    pool_size=5,
    max_overflow=10,
)

app_engine = create_async_engine(
    settings.app_database_url,
    echo=False,
    pool_pre_ping=True,
    pool_size=5,
    max_overflow=10,
)

PracticeSessionLocal = async_sessionmaker(
    practice_engine, class_=AsyncSession, expire_on_commit=False
)
AppSessionLocal = async_sessionmaker(
    app_engine, class_=AsyncSession, expire_on_commit=False
)


async def get_app_db() -> AsyncGenerator[AsyncSession, None]:
    async with AppSessionLocal() as session:
        try:
            yield session
            await session.commit()
        except Exception:
            await session.rollback()
            raise


async def get_practice_db() -> AsyncGenerator[AsyncSession, None]:
    async with PracticeSessionLocal() as session:
        try:
            yield session
        except Exception:
            await session.rollback()
            raise
        finally:
            await session.close()
