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


settings = Settings()
