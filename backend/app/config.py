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


settings = Settings()
