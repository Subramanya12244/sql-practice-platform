"""Ensure Git Lab schema columns exist (create_all does not ALTER)."""

from __future__ import annotations

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncEngine


GIT_SCHEMA_STATEMENTS = [
    # git_questions expansions
    "ALTER TABLE git_questions ADD COLUMN IF NOT EXISTS stable_id VARCHAR(200)",
    "ALTER TABLE git_questions ADD COLUMN IF NOT EXISTS exercise_type VARCHAR(40) DEFAULT 'command'",
    "ALTER TABLE git_questions ADD COLUMN IF NOT EXISTS tags JSONB DEFAULT '[]'::jsonb",
    "ALTER TABLE git_questions ADD COLUMN IF NOT EXISTS expected_answer TEXT",
    "ALTER TABLE git_questions ADD COLUMN IF NOT EXISTS choices JSONB DEFAULT '[]'::jsonb",
    "ALTER TABLE git_questions ADD COLUMN IF NOT EXISTS source VARCHAR(200)",
    "ALTER TABLE git_questions ADD COLUMN IF NOT EXISTS source_file VARCHAR(400)",
    "ALTER TABLE git_questions ADD COLUMN IF NOT EXISTS source_section VARCHAR(300)",
    "ALTER TABLE git_questions ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT NOW()",
    # git_attempts expansions
    "ALTER TABLE git_attempts ADD COLUMN IF NOT EXISTS correct_count INTEGER DEFAULT 0",
    "ALTER TABLE git_attempts ADD COLUMN IF NOT EXISTS incorrect_count INTEGER DEFAULT 0",
]


async def ensure_git_schema(engine: AsyncEngine) -> None:
    async with engine.begin() as conn:
        for stmt in GIT_SCHEMA_STATEMENTS:
            await conn.execute(text(stmt))
        # Backfill stable_id for legacy rows
        await conn.execute(
            text(
                """
                UPDATE git_questions
                SET stable_id = 'legacy:' || question_number::text
                WHERE stable_id IS NULL OR stable_id = ''
                """
            )
        )
        await conn.execute(
            text(
                """
                UPDATE git_questions
                SET exercise_type = COALESCE(NULLIF(exercise_type, ''), mode, 'command')
                WHERE exercise_type IS NULL OR exercise_type = ''
                """
            )
        )
        # Unique index on stable_id (ignore if exists)
        await conn.execute(
            text(
                """
                CREATE UNIQUE INDEX IF NOT EXISTS uq_git_questions_stable_id
                ON git_questions (stable_id)
                """
            )
        )
        # Normalize legacy difficulties
        await conn.execute(
            text(
                """
                UPDATE git_questions SET difficulty = CASE
                    WHEN lower(difficulty) IN ('beginner', 'easy') THEN 'Easy'
                    WHEN lower(difficulty) IN ('intermediate', 'medium') THEN 'Medium'
                    WHEN lower(difficulty) IN ('advanced', 'hard', 'senior') THEN 'Hard'
                    WHEN lower(difficulty) = 'expert' THEN 'Expert'
                    ELSE difficulty
                END
                """
            )
        )
