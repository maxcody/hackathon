# Hackathon

FastAPI + Postgres backend.

## Stack
- FastAPI, async SQLAlchemy 2, asyncpg, Alembic
- Provider-agnostic LLM calls via LiteLLM (`LLM_MODEL`, `LLM_API_KEY`, `LLM_BASE_URL`)
- ruff, black, isort, pytest, pre-commit

## Setup
```bash
docker compose up -d db

cd backend
python3 -m venv .venv && source .venv/bin/activate
pip install -r requirements-dev.txt
cp .env.example .env

make migrate
make run
```
API docs: http://localhost:8000/docs

## Make targets (run from `backend/`)
| Target | Description |
| --- | --- |
| `make run` | Start the dev server with reload |
| `make migrate` | Apply migrations |
| `make revision m="msg"` | Autogenerate a migration |
| `make fmt` | Format and auto-fix |
| `make lint` | Check ruff, black, isort |
| `make test` | Run tests |

Run `pre-commit install` once to enable the format hooks.
