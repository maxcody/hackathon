# AGENTS.md

Instructions for AI coding agents (Codex, Claude Code and others) working in this repo.

## Project
FastAPI + Postgres backend in `backend/`. Async SQLAlchemy 2 (asyncpg), Alembic migrations, pydantic-settings config.

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
- Frontend UI uses Meta Astryx (`frontend/`); follow `frontend/AGENTS.md` and `npx @astryxdesign/cli` before changing screens

## Code practices
Read and follow `CODE_PRACTICES.md` at the repo root (DRY, Python docstrings, TSDoc for TypeScript).

## Working style
- State assumptions and ask when requirements are unclear; don't pick silently between interpretations.
- Make the minimum change that solves the task; touch only what the task needs.
- Define how to verify the result (a test or command) and run it before finishing.
