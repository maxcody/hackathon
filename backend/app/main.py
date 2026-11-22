import asyncio
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager, suppress
from pathlib import Path

import truststore
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from sqlalchemy import text

from app.config import settings
from app.db import engine
from app.mail_triage import triage_loop
from app.routers import (
    agent_workspace,
    dataset,
    imported,
    imports,
    inbox,
    notifications,
    readiness,
    skills,
    solutions,
)

# Trust the OS certificate store, so portal calls work behind TLS-inspecting proxies
truststore.inject_into_ssl()


@asynccontextmanager
async def lifespan(_: FastAPI) -> AsyncIterator[None]:
    """Run the email-triage job alongside the API when it is enabled."""
    job = asyncio.create_task(triage_loop()) if settings.mail_triage else None
    yield
    if job:
        job.cancel()
        with suppress(asyncio.CancelledError):
            await job


app = FastAPI(title="Hackathon API", lifespan=lifespan)
static_dir = Path(__file__).parent / "static"
app.mount("/static", StaticFiles(directory=static_dir), name="static")
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins,
    allow_methods=["*"],
    allow_headers=["*"],
)
app.include_router(imported.router)
app.include_router(imports.router)
app.include_router(notifications.router)
app.include_router(solutions.router)
app.include_router(readiness.router)
app.include_router(inbox.router)
app.include_router(dataset.router)
app.include_router(skills.router)
app.include_router(agent_workspace.router)


@app.get("/", include_in_schema=False)
async def home() -> FileResponse:
    """Serve the built React dashboard (``npm run build`` in ``frontend/``)."""
    return FileResponse(static_dir / "react" / "index.html")


@app.get("/health")
async def health():
    async with engine.connect() as conn:
        await conn.execute(text("SELECT 1"))
    return {"status": "ok", "db": "ok"}
