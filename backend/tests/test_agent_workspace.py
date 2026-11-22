"""Exercise agent creation, chat, and conversation isolation."""

from pathlib import Path
from unittest.mock import AsyncMock

import pytest
from fastapi.testclient import TestClient

from app.main import app
from app.routers import agent_workspace
from app.services.agent_workspace import AgentWorkspace


def test_agent_chats_are_independent(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    """Save replies to the selected agent while other agents stay empty."""
    path = tmp_path / "agents.sqlite3"
    monkeypatch.setattr(agent_workspace, "workspace", AgentWorkspace(path))
    monkeypatch.setattr(agent_workspace.settings, "chat_engine", "openai")
    monkeypatch.setattr(agent_workspace.settings, "llm_api_key", "test-key")
    monkeypatch.setattr(agent_workspace.settings, "llm_model", "test-model")
    reply = AsyncMock(return_value="Check the delivery date.")
    monkeypatch.setattr(agent_workspace, "reply_to_agent", reply)

    with TestClient(app) as client:
        prefix = "/api/agent-workspace"
        assert client.get(prefix).json() == []
        first_response = client.post(prefix, json={"name": "First"})
        assert first_response.status_code == 201
        first = first_response.json()
        second = client.post(prefix, json={"name": "Second"}).json()
        response = client.post(
            f"{prefix}/{first['id']}/chat", json={"message": "Hello"}
        )
        assert response.status_code == 200
        assert response.json()["messages"] == [
            {"role": "user", "content": "Hello"},
            {"role": "assistant", "content": "Check the delivery date."},
        ]
        assert client.get(f"{prefix}/{second['id']}").json()["messages"] == []
        assert client.get(f"{prefix}/missing").status_code == 404

    saved = AgentWorkspace(path).load(first["id"])
    assert saved is not None
    assert saved[0].messages[-1].role == "assistant"
