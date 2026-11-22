from pathlib import Path

import truststore
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from sqlalchemy import text

from app.config import settings
from app.db import engine
from app.routers import agent_workspace, imported, imports, notifications, solutions

# Trust the OS certificate store, so portal calls work behind TLS-inspecting proxies
truststore.inject_into_ssl()

app = FastAPI(title="Hackathon API")
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
