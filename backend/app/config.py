from pathlib import Path

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    database_url: str = (
        "postgresql+asyncpg://postgres:postgres@localhost:5432/hackathon"
    )
    cors_origins: list[str] = ["http://localhost:3000", "http://localhost:5173"]
    # Provider-agnostic LLM settings, used with the OpenAI SDK. Point
    # llm_base_url at any OpenAI-compatible endpoint (OpenAI, Ollama, Groq, ...).
    llm_model: str | None = None
    llm_api_key: str | None = None
    llm_base_url: str | None = None
    soony_portal_url: str | None = None
    soony_portal_token: str | None = None
    soony_portal_token_header: str = "Authorization"
    soony_portal_token_prefix: str = "Bearer"
    data_dir: Path = Path(__file__).resolve().parents[2] / ".local_data"


settings = Settings()
