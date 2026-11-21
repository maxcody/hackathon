from pathlib import Path

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, HTMLResponse, Response
from fastapi.staticfiles import StaticFiles
from sqlalchemy import text

from app.config import settings
from app.db import engine
from app.routers import imported, imports, notifications

app = FastAPI(title="Hackathon API")
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins,
    allow_methods=["*"],
    allow_headers=["*"],
)
app.include_router(imported.router)
app.include_router(imports.router)
app.include_router(notifications.router)

static_dir = Path(__file__).parent / "static"
react_dir = static_dir / "react"
react_index = react_dir / "index.html"
if static_dir.is_dir():
    app.mount("/static", StaticFiles(directory=static_dir), name="static")


@app.get("/", include_in_schema=False)
async def frontend() -> Response:
    """Serve the built React dashboard, or show local setup instructions."""
    if react_index.is_file():
        return FileResponse(react_index)
    return HTMLResponse(
        "<main style='font:16px system-ui;max-width:680px;margin:12vh auto;padding:24px'>"
        "<h1>Soony Supply Control</h1><p>The React dashboard has not been built yet.</p>"
        "<p>From the <code>frontend</code> folder run <code>npm install</code> and "
        "<code>npm run build</code>, then refresh this page.</p>"
        "<p><a href='/docs'>Open the API documentation</a></p></main>",
        status_code=503,
    )


@app.get("/health")
async def health():
    async with engine.connect() as conn:
        await conn.execute(text("SELECT 1"))
    return {"status": "ok", "db": "ok"}
