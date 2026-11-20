from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    database_url: str = (
        "postgresql+asyncpg://postgres:postgres@localhost:5432/hackathon"
    )
    cors_origins: list[str] = ["http://localhost:3000", "http://localhost:5173"]
    # Provider-agnostic LLM settings (used with LiteLLM, e.g. "anthropic/<model>",
    # "openai/<model>", "gemini/<model>", "ollama/<model>")
    llm_model: str | None = None
    llm_api_key: str | None = None
    llm_base_url: str | None = None


settings = Settings()
