from pathlib import Path
from typing import Literal

from pydantic import PositiveInt
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    database_url: str = (
        "postgresql+asyncpg://postgres:postgres@localhost:5432/hackathon"
    )
    cors_origins: list[str] = ["http://localhost:3000", "http://localhost:5173"]
    # Folder holding the confidential Soony data (contains soony/ and suppliers/)
    data_dir: str = "~/Desktop/soony-data"
    # Soony customer portal API: base URL, and the team token from its Settings page
    portal_url: str | None = None
    portal_token: str | None = None
    # Dashboard chat engine: "codex" runs the local Codex CLI with its MCP tools,
    # "openai" calls LLM_MODEL directly (no tools).
    chat_engine: Literal["codex", "openai"] = "codex"
    codex_model: str | None = None  # empty: Codex's own default model
    codex_reasoning_effort: Literal["minimal", "low", "medium", "high"] = "low"
    codex_timeout_seconds: PositiveInt = 300
    # Only used by CHAT_ENGINE=openai; any OpenAI-compatible endpoint works.
    llm_model: str | None = None
    llm_api_key: str | None = None
    llm_base_url: str | None = None
    # SQLite file holding the dashboard's chat agents and their conversations
    agents_db: Path = (
        Path(__file__).resolve().parents[2] / ".local_data" / "agents.sqlite3"
    )


settings = Settings()
