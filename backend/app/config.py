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
    # Soony customer portal API; the team token is on the portal Settings page
    portal_url: str = (
        "https://start-hack-portal-cxh3crbdaef2f8gt.westeurope-01.azurewebsites.net"
    )
    portal_token: str | None = None
    # Provider-agnostic LLM settings, used with the OpenAI SDK. Point
    # llm_base_url at any OpenAI-compatible endpoint (OpenAI, Ollama, Groq, ...).
    llm_model: str | None = None
    llm_api_key: str | None = None
    llm_base_url: str | None = None
    agent_access_key: str | None = None
    # Dashboard chat engine: "codex" runs the local Codex CLI with its MCP tools,
    # "openai" calls LLM_MODEL directly (no tools).
    chat_engine: Literal["codex", "openai"] = "codex"
    codex_model: str | None = None  # empty: Codex's own default model
    codex_reasoning_effort: Literal["minimal", "low", "medium", "high"] = "low"
    codex_timeout_seconds: PositiveInt = 300
    hermes_base_url: str | None = None
    hermes_api_key: str | None = None
    hermes_trigger_key: str | None = None
    soony_portal_url: str | None = None
    soony_portal_token: str | None = None
    soony_portal_token_header: str = "Authorization"
    soony_portal_token_prefix: str = "Bearer"
    archive_dir: Path = Path(__file__).resolve().parents[2] / ".local_data"


settings = Settings()
