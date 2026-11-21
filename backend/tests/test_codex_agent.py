"""Tests for the Codex chat engine."""

import json
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from app.codex_agent import CodexError, build_command, parse_events
from app.main import app
from app.routers import agent_workspace
from app.services.agent_workspace import AgentWorkspace


def events(*rows: dict) -> str:
    """Encode events as Codex's JSON lines (first line with a BOM, as on Windows)."""
    return "﻿" + "\n".join(json.dumps(row) for row in rows)


def test_parse_events_returns_last_message_and_thread() -> None:
    output = events(
        {"type": "thread.started", "thread_id": "t-1"},
        {"type": "item.completed", "item": {"type": "agent_message", "text": "Hm"}},
        {"type": "item.completed", "item": {"type": "agent_message", "text": "84"}},
    )
    assert parse_events(output) == ("84", "t-1")


def test_parse_events_raises_codex_error_message() -> None:
    output = events({"type": "error", "message": "not logged in"})
    with pytest.raises(CodexError, match="not logged in"):
        parse_events(output)


def test_resume_command_reuses_thread_and_approves_tools() -> None:
    command = build_command("codex", "t-1")
    assert command[:3] == ["codex", "exec", "resume"]
    assert command[-2:] == ["t-1", "-"]
    assert 'mcp_servers.email.default_tools_approval_mode="approve"' in command


def test_chat_resumes_the_agents_codex_session(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr(
        agent_workspace, "workspace", AgentWorkspace(tmp_path / "a.sqlite3")
    )
    monkeypatch.setattr(agent_workspace.settings, "chat_engine", "codex")
    calls = []

    def fake_turn(prompt: str, thread: str | None) -> tuple[str, str]:
        calls.append((prompt, thread))
        return f"answer {len(calls)}", "t-1"

    monkeypatch.setattr(agent_workspace, "run_turn", fake_turn)
    prefix = "/api/agent-workspace"
    with TestClient(app) as client:
        agent = client.post(prefix, json={"name": "A", "instructions": "Be terse"})
        agent_id = agent.json()["id"]
        client.post(f"{prefix}/{agent_id}/chat", json={"message": "Hi"})
        reply = client.post(f"{prefix}/{agent_id}/chat", json={"message": "More"})

    assert reply.status_code == 200
    assert [m["content"] for m in reply.json()["messages"]] == [
        "Hi",
        "answer 1",
        "More",
        "answer 2",
    ]
    assert calls[0][1] is None and "Be terse" in calls[0][0]  # new session
    assert calls[1] == ("More", "t-1")  # resumed, no repeated guidance
