"""Application settings loaded from environment variables."""

from functools import lru_cache
from typing import List

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=(".env", "../.env"),
        env_file_encoding="utf-8",
        extra="ignore",
    )

    # Practice DB (Northwind) — read-only execution
    database_url: str = (
        "postgresql+asyncpg://sql_readonly:readonly_pass@localhost:5432/northwind"
    )

    # App metadata DB
    app_database_url: str = (
        "postgresql+asyncpg://sql_app:app_pass@localhost:5432/sql_practice"
    )

    # Admin URLs for migrations / seed
    database_admin_url: str = (
        "postgresql+asyncpg://postgres:postgres@localhost:5432/northwind"
    )
    app_database_admin_url: str = (
        "postgresql+asyncpg://postgres:postgres@localhost:5432/sql_practice"
    )

    github_repository: str = ""
    github_token: str = ""
    github_branch: str = "main"
    github_questions_path: str = "questions/questions.json"
    # Local clone of Subramanya12244/northwind-sql-practice (preferred sync source)
    northwind_repo_path: str = ""

    query_timeout_seconds: int = 5
    query_max_rows: int = 1000

    backend_port: int = 8000
    frontend_port: int = 5173
    cors_origins: str = "http://localhost:5173,http://localhost:3000"

    default_user_id: int = 1
    default_user_name: str = "local_user"

    questions_file_path: str = "../questions/questions.json"

    # ------------------------------------------------------------------
    # Multi-project datasets
    # ------------------------------------------------------------------
    # Server-level connection (database "postgres") used only to CREATE DATABASE.
    postgres_admin_url: str = (
        "postgresql+asyncpg://postgres:postgres@localhost:5432/postgres"
    )
    # Host/port/credentials used to build per-project connection URLs.
    project_db_host: str = "localhost"
    project_db_port: int = 5432
    project_db_owner: str = "postgres"
    project_db_owner_password: str = "postgres"
    # Read-only role granted SELECT on every project database.
    project_db_readonly_user: str = "sql_readonly"
    project_db_readonly_password: str = "readonly_pass"
    # Prefix for provisioned databases, keeps them identifiable.
    project_db_prefix: str = "sqlp_"
    # Where uploaded files + generated schema.sql/seed.sql live.
    projects_root: str = "../projects"
    max_upload_mb: int = 200

    # Git Practice Lab curriculum seed
    git_curriculum_path: str = "../questions/git/curriculum.json"

    # Allow QUESTIONS_FILE_PATH env override used in Docker

    @property
    def cors_origin_list(self) -> List[str]:
        return [o.strip() for o in self.cors_origins.split(",") if o.strip()]


@lru_cache
def get_settings() -> Settings:
    return Settings()
