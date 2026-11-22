# Linewatch — Soony Launch Control

Dashboard and agents for the Lio Hack League case. The backend stores Soony's launch data and the notifications the dashboard shows (see `backend/HOW_IT_WORKS.md`). The analysis runs in Codex agents outside the backend: they read the portal data, write findings as notifications and can email suppliers.

## How the parts fit
- **Backend** (`backend/`): Postgres CRUD over products, components, BOM, sheet rows and notifications, plus `/import/sync|master|sheets` to load the portal files. It also serves the built dashboard at `/` and the agent chat at `/api/agent-workspace`.
- **Dashboard** (`frontend/`): shows the notifications, triggers portal sync and imports, and hosts the **Agents** tab.
- **Agents**: each dashboard agent is a Codex session with three MCP tools from `backend/scripts/`: `portal` (read portal files), `notifications` (post findings to `/notifications`) and `email` (send mail after confirmation).

## Stack
- FastAPI, async SQLAlchemy 2, asyncpg, Alembic
- React, TypeScript, and Vite for the dashboard
- Codex CLI for the agents; optional direct chat via the OpenAI SDK (`CHAT_ENGINE=openai`, `LLM_MODEL`, `LLM_API_KEY`, `LLM_BASE_URL`)
- ruff, black, isort, pytest, pre-commit

## Backend structure
- `backend/app/main.py`: FastAPI app, CORS, router registration, `/health`
- `backend/app/config.py`: settings loaded from `.env` (database URL, CORS origins)
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
```powershell
docker compose up -d db          # from the repo root
cd backend
py -m venv .venv
.\.venv\Scripts\Activate.ps1
pip install -r requirements-dev.txt
Copy-Item .env.example .env
make migrate
uvicorn app.main:app --reload
```
For frontend development, keep the API running in one terminal and start Vite in a second:
```powershell
cd frontend
npm install
npm run dev
```
Open the Vite URL printed in the terminal (normally http://127.0.0.1:5173/). Vite proxies `/api`, `/import` and `/notifications` requests to `http://127.0.0.1:8000`. If the backend is using another port, set the proxy first, for example `$env:VITE_API_PROXY_TARGET="http://127.0.0.1:8001"`.

To build the React dashboard for FastAPI, run `npm run build` from `frontend/`. Then open http://localhost:8000/; FastAPI serves the built React app. API docs: http://localhost:8000/docs.

## Agents tab

Open **Agents** in the dashboard to create an agent with a name and optional
instructions. Agents and their chats live in `.local_data/agents.sqlite3`.
By default each agent runs as a Codex session (`codex exec`) with the `portal`,
`notifications` and `email` MCP tools; follow-up messages resume the session.
Set `CHAT_ENGINE=openai` to answer through `LLM_MODEL` directly instead (no tools).
Codex options: `CODEX_MODEL`, `CODEX_REASONING_EFFORT` (default `low`),
`CODEX_TIMEOUT_SECONDS` (default 1200).

## Run multiple Codex coding assistants

Install and sign in to the Codex CLI on the machine that will run the agents.
From the repository root, run a batch of named tasks:

```powershell
.\.venv\Scripts\python.exe backend/scripts/launch_codex_agents.py --parallel 2 --task 'review=Review the dashboard API integration' --task 'tests=Identify missing tests for the import workflow'
```

Each task gets an independent Codex session. The launcher prints the run
directory under `.local_data/codex-runs/`, with a `reply.md`, `events.jsonl`, and
`stderr.log` per agent. A batch exits with a failure status if any agent fails.
The default sandbox is read-only. Add `--write` to give each agent a separate
Codex-managed Git worktree. Use `--timeout` to cap each session in seconds.

## Office-hours questions
- **Nils (IT):** Which files are authoritative for PO, goods receipt, and pack-out quantities? How do we recognize a replacement export versus a new event?
- **Felix (buyer):** Which component or supplier currently gates pack-out? What are the last truck and dock cutoffs for Hamburg?
- **Maren (procurement):** Which edition shortfall causes the greatest customer cost, what expedite spend is acceptable, and who must approve it?

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
