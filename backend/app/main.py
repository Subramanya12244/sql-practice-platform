"""DataForge (formerly SQL Practice Platform) — FastAPI application entrypoint."""

from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.api.routes import router
from app.api.import_routes import import_router, data_router
from app.api.project_routes import project_router
from app.api.git_routes import git_router
from app.config import get_settings
from app.database.init_db import init_app_db


@asynccontextmanager
async def lifespan(_app: FastAPI):
    await init_app_db()
    yield


settings = get_settings()

app = FastAPI(
    title="DataForge API",
    description="SQL interview practice and Git Practice Lab.",
    version="1.1.0",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origin_list,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(router)
app.include_router(import_router)
app.include_router(data_router)
app.include_router(project_router)
app.include_router(git_router)


@app.get("/health")
async def health():
    return {"status": "ok"}
