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
