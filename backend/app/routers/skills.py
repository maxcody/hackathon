"""Run agent skills (e.g. the risk check) from the dashboard and show their status.

A run starts a fresh Codex session in the background, so the dashboard does not
wait for it; the latest run per skill is kept in ``.local_data/skill_runs.json``.
"""

import asyncio
import json
import threading
from datetime import UTC, datetime, timedelta
from typing import Literal

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from app.codex_agent import CodexError, run_turn
from app.config import settings
from app.mailer import BACKEND

router = APIRouter(prefix="/skills", tags=["skills"])

SKILLS_DIR = BACKEND / "agent_skills"
STORE = BACKEND.parent / ".local_data" / "skill_runs.json"
_lock = threading.Lock()
_tasks: set[asyncio.Task] = set()  # keep running tasks referenced


class SkillRun(BaseModel):
    """The latest run of one skill."""

    skill: str
    status: Literal["never", "running", "done", "failed"] = "never"
    started_at: str | None = None
    finished_at: str | None = None
    summary: str = ""  # the agent's closing reply
    error: str | None = None


def _load() -> dict[str, dict]:
    with _lock:
        return json.loads(STORE.read_text("utf-8")) if STORE.exists() else {}


def _save(run: SkillRun) -> None:
    with _lock:
        runs = json.loads(STORE.read_text("utf-8")) if STORE.exists() else {}
        runs[run.skill] = run.model_dump()
        STORE.parent.mkdir(parents=True, exist_ok=True)
        STORE.write_text(json.dumps(runs, ensure_ascii=False, indent=1), "utf-8")


def latest(skill: str) -> SkillRun:
    """The latest run; a run older than the Codex timeout counts as failed."""
    run = SkillRun(**_load().get(skill, {"skill": skill}))
    if run.status == "running" and run.started_at:
        limit = timedelta(seconds=settings.codex_timeout_seconds + 120)
        if datetime.now(UTC) - datetime.fromisoformat(run.started_at) > limit:
            run.status, run.error = "failed", "Interrupted (backend restarted?)."
    return run


def _execute(skill: str, started: str) -> None:
    """Run the skill in a new Codex session and record the outcome."""
    prompt = (
        f'Run the {skill} skill: call the skills tool get_skill with name "{skill}" '
        "now and follow every step."
    )
    try:
        reply, _ = run_turn(prompt, None)
        run = SkillRun(skill=skill, status="done", summary=reply[:6000])
    except CodexError as error:
        run = SkillRun(skill=skill, status="failed", error=str(error))
    run.started_at, run.finished_at = started, datetime.now(UTC).isoformat()
    _save(run)


@router.get("/{skill}")
def get_run(skill: str) -> SkillRun:
    """Status of the latest run of a skill."""
    if not (SKILLS_DIR / skill / "SKILL.md").exists():
        raise HTTPException(404, f"Unknown skill {skill!r}.")
    return latest(skill)


@router.post("/{skill}/run", status_code=202)
async def start_run(skill: str) -> SkillRun:
    """Start a skill run in the background (one at a time per skill)."""
    if not (SKILLS_DIR / skill / "SKILL.md").exists():
        raise HTTPException(404, f"Unknown skill {skill!r}.")
    if latest(skill).status == "running":
        raise HTTPException(409, "This skill is already running.")
    run = SkillRun(
        skill=skill, status="running", started_at=datetime.now(UTC).isoformat()
    )
    _save(run)
    task = asyncio.create_task(asyncio.to_thread(_execute, skill, run.started_at))
    _tasks.add(task)
    task.add_done_callback(_tasks.discard)
    return run
