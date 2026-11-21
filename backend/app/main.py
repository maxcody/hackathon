from pathlib import Path

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from sqlalchemy import text

from app.config import settings
from app.db import engine
from app.routers import (
    agent,
    agent_workspace,
    files,
    findings,
    hermes,
    launch,
    master,
    sheets,
    status,
    sync,
)

app = FastAPI(title="Linewatch — Soony Launch Control")
static_dir = Path(__file__).parent / "static"
react_index = static_dir / "react" / "index.html"
app.mount("/static", StaticFiles(directory=static_dir), name="static")
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins,
    allow_methods=["*"],
    allow_headers=["*"],
)
app.include_router(launch.router)
app.include_router(hermes.router)
app.include_router(agent.router)
app.include_router(agent_workspace.router)
app.include_router(files.router)
app.include_router(findings.router)
app.include_router(master.router)
app.include_router(sheets.router)
app.include_router(status.router)
app.include_router(sync.router)


@app.get("/", include_in_schema=False)
async def home() -> FileResponse:
    """Serve the built React dashboard, with the legacy page as fallback."""
    index = react_index if react_index.exists() else static_dir / "index.html"
    return FileResponse(index)


@app.get("/health")
async def health():
    async with engine.connect() as conn:
        await conn.execute(text("SELECT 1"))
    return {"status": "ok", "db": "ok"}
