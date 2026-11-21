# Hackathon

FastAPI + Postgres backend.

## Stack
- FastAPI, async SQLAlchemy 2, asyncpg, Alembic
- LLM calls via the OpenAI SDK, usable with any OpenAI-compatible provider (`LLM_MODEL`, `LLM_API_KEY`, `LLM_BASE_URL`)
- ruff, black, isort, pytest, pre-commit

## Backend structure
- `backend/app/main.py`: FastAPI app, CORS, router registration, `/health`
- `backend/app/config.py`: settings loaded from `.env` (database URL, CORS origins, `LLM_*`)
- `backend/app/db.py`: async SQLAlchemy engine and the `get_session` dependency
- `backend/app/models/`: SQLAlchemy table models (`Base` lives in `base.py`)
- `backend/app/schemas/`: Pydantic request and response schemas
- `backend/app/routers/`: API endpoints, one file per resource
- `backend/alembic/versions/`: database migration scripts
- `backend/tests/`: pytest tests
- `backend/.pre-commit-config.yaml`: pre-commit hooks (isort, black, ruff) run on each commit after `pre-commit install`
- `backend/.env.example`: template for the local `.env` (never commit `.env`)
- `docker-compose.yml`: local Postgres (repo root)
- `.github/workflows/ci.yml`: CI that runs lint and tests

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

## Claude Code setup (optional)
The repo ships shared config so collaborators get the same tools:
- `.mcp.json`: Context7 MCP for up-to-date library docs (needs Node/`npx`)
- `.claude/settings.json`: enables the Ponytail and Karpathy skills plugins

Open the folder in Claude Code and accept the workspace trust prompt. The plugins install and Context7 is approved automatically.

Manual fallback (run inside Claude Code):
```
/plugin marketplace add DietrichGebert/ponytail
/plugin install ponytail@ponytail
/plugin marketplace add forrestchang/andrej-karpathy-skills
/plugin install andrej-karpathy-skills@karpathy-skills
```
Ponytail does not work in the VS Code chat panel; use the terminal CLI (`claude`) or the desktop app.
