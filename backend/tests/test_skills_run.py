"""Starting a skill run from the dashboard and reading its status."""

import asyncio
from pathlib import Path

import pytest
from httpx import ASGITransport, AsyncClient

from app.codex_agent import CodexError
from app.main import app
from app.routers import skills


@pytest.fixture
async def api(tmp_path: Path, monkeypatch: pytest.MonkeyPatch):
    """An API client with the run store in a temp folder."""
    monkeypatch.setattr(skills, "STORE", tmp_path / "runs.json")
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://t") as c:
        yield c


async def wait_until_finished(api: AsyncClient) -> dict:
    """Poll until the background run is no longer running."""
    for _ in range(50):
        run = (await api.get("/skills/risk-check")).json()
        if run["status"] != "running":
            return run
        await asyncio.sleep(0.02)
    raise AssertionError("run did not finish")


async def test_run_records_the_agent_reply(api, monkeypatch) -> None:
    prompts: list[str] = []
    monkeypatch.setattr(
        skills,
        "run_turn",
        lambda prompt, thread: prompts.append(prompt) or ("Updated 22.", "t"),
    )
    assert (await api.get("/skills/risk-check")).json()["status"] == "never"
    started = await api.post("/skills/risk-check/run")
    assert started.status_code == 202 and started.json()["status"] == "running"
    run = await wait_until_finished(api)
    assert run["status"] == "done" and run["summary"] == "Updated 22."
    assert 'get_skill with name "risk-check"' in prompts[0]


async def test_failures_and_unknown_skills(api, monkeypatch) -> None:
    def broken(prompt: str, thread: str | None) -> tuple[str, str]:
        raise CodexError("Codex took too long to answer.")

    monkeypatch.setattr(skills, "run_turn", broken)
    await api.post("/skills/risk-check/run")
    run = await wait_until_finished(api)
    assert run["status"] == "failed" and "too long" in run["error"]
    assert (await api.post("/skills/nope/run")).status_code == 404
