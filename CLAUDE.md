# CLAUDE.md

## Project
FastAPI + Postgres backend in `backend/`. Async SQLAlchemy 2 (asyncpg), Alembic migrations, pydantic-settings config, LLM calls through the OpenAI SDK, usable with any OpenAI-compatible provider (`LLM_MODEL`, `LLM_API_KEY`, `LLM_BASE_URL`).

## Commands (run from `backend/`, venv active)
- `docker compose up -d db` (from repo root) starts Postgres
- `make run` / `make migrate` / `make revision m="msg"`
- `make fmt` formats and auto-fixes; `make lint` and `make test` must pass before committing

## Conventions
- Layout: `app/routers` (one file per resource), `app/models`, `app/schemas`, `app/config.py`, `app/db.py`
- Use `Annotated[..., Depends(...)]` for dependencies (ruff B008)
- Every model change needs an Alembic migration
- Config goes in `app/config.py` and `backend/.env.example`; never commit `.env`
- Commit messages: plain imperative summary, no `chore:` prefix, no attribution lines

## Code practices
Follow @CODE_PRACTICES.md (DRY, Python docstrings, TSDoc for TypeScript).

## Coding guidelines
Provided by the `andrej-karpathy-skills` plugin (enabled in `.claude/settings.json`).
