"""Store private agent definitions and conversations in the local data directory."""

import sqlite3
from collections.abc import Iterator
from contextlib import contextmanager
from pathlib import Path
from uuid import uuid4

from pydantic import TypeAdapter

from app.schemas.agent_workspace import (
    AgentCreate,
    AgentSummary,
    ChatMessage,
    WorkspaceAgent,
)

messages_json = TypeAdapter(list[ChatMessage])


class AgentWorkspace:
    """Persist independent conversations without a running Postgres service."""

    def __init__(self, path: Path) -> None:
        """Use the supplied SQLite database file."""
        self.path = path

    @contextmanager
    def _connect(self) -> Iterator[sqlite3.Connection]:
        self.path.parent.mkdir(parents=True, exist_ok=True)
        connection = sqlite3.connect(self.path)
        connection.row_factory = sqlite3.Row
        try:
            with connection:
                connection.execute("""CREATE TABLE IF NOT EXISTS agents (
                        id TEXT PRIMARY KEY, name TEXT NOT NULL,
                        instructions TEXT NOT NULL, messages TEXT NOT NULL,
                        revision INTEGER NOT NULL DEFAULT 0
                    )""")
                columns = {
                    r[1] for r in connection.execute("PRAGMA table_info(agents)")
                }
                if "codex_thread" not in columns:  # added for the Codex chat engine
                    connection.execute(
                        "ALTER TABLE agents ADD COLUMN codex_thread TEXT"
                    )
                yield connection
        finally:
            connection.close()

    def list_agents(self) -> list[AgentSummary]:
        """Return each agent in creation order."""
        with self._connect() as connection:
            rows = connection.execute("SELECT id, name FROM agents ORDER BY rowid")
            return [AgentSummary(**dict(row)) for row in rows]

    def create(self, definition: AgentCreate) -> WorkspaceAgent:
        """Save a new agent with an empty conversation."""
        agent = WorkspaceAgent(id=uuid4().hex, **definition.model_dump(), messages=[])
        with self._connect() as connection:
            connection.execute(
                "INSERT INTO agents (id, name, instructions, messages) "
                "VALUES (?, ?, ?, '[]')",
                (agent.id, agent.name, agent.instructions),
            )
        return agent

    def load(self, agent_id: str) -> tuple[WorkspaceAgent, int] | None:
        """Return the agent and its conversation revision if it exists."""
        with self._connect() as connection:
            row = connection.execute(
                "SELECT * FROM agents WHERE id = ?", (agent_id,)
            ).fetchone()
        if row is None:
            return None
        agent = WorkspaceAgent(
            id=row["id"],
            name=row["name"],
            instructions=row["instructions"],
            messages=messages_json.validate_json(row["messages"]),
        )
        return agent, row["revision"]

    def save(
        self, agent: WorkspaceAgent, revision: int, codex_thread: str | None = None
    ) -> bool:
        """Save a completed turn if another request has not changed the conversation.

        Args:
            agent: The agent with its updated messages.
            revision: Revision the turn started from.
            codex_thread: Codex session to store; None keeps the current one.

        Returns:
            Whether the turn was saved.
        """
        with self._connect() as connection:
            result = connection.execute(
                """UPDATE agents SET messages = ?, revision = revision + 1,
                   codex_thread = COALESCE(?, codex_thread)
                   WHERE id = ? AND revision = ?""",
                (
                    messages_json.dump_json(agent.messages).decode(),
                    codex_thread,
                    agent.id,
                    revision,
                ),
            )
            return result.rowcount == 1

    def codex_thread(self, agent_id: str) -> str | None:
        """Return the Codex session that holds this agent's context, if any."""
        with self._connect() as connection:
            row = connection.execute(
                "SELECT codex_thread FROM agents WHERE id = ?", (agent_id,)
            ).fetchone()
        return row["codex_thread"] if row else None
