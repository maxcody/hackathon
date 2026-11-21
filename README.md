# Linewatch — Soony Launch Control

An evidence-backed procurement response prototype for the Lio Hack League case. Linewatch reconciles the verified kickoff quantities, inspects supplier and logistics files, detects changed files and operational risk signals, and prepares supplier follow-up drafts for human review.

## What works now
- Dashboard for the supplied kickoff baseline: 640,000 Standard and 72,000 Collector's Editions required; 512,000 and 46,800 packed respectively.
- Baseline Reconciler calculates the 153,200 units still to pack.
- Shortage Prioritizer flags the Collector's Edition as the largest proportional gap (35% remaining).
- Supplier Chaser creates a reviewable email draft that asks for pack-out, issue, and dispatch confirmations. It does not send email or guess supplier ownership.
- Archive Monitor compares successive imports and shows new, changed, and removed files.
- Risk Triage flags supplier bank-change and cyber-compromise notices, weather/port disruption notices, PO confirmation shortfalls, receipts below confirmed quantities, disrupted statuses, and past delivery dates. Findings name their source file and row when available.
- Evidence and limitations stay visible in the UI and API response.

The Soony portal credentials are not in the repository. Until configured, the dashboard uses only the kickoff baseline and lets you import the portal's ZIP archive manually. The importer handles CSV, TSV, JSON, EML, DOCX, PDF text, and XLSX files. It indexes image scans, scanned PDFs, and unknown formats with a review warning rather than discarding them; OCR is not enabled yet. Detected weather or port events are not assumed to affect a particular order without route and supplier evidence. Bank changes never update payment details; they trigger out-of-band verification advice.

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
```powershell
cd backend
py -m venv .venv
.\.venv\Scripts\Activate.ps1
pip install -r requirements-dev.txt
Copy-Item .env.example .env
uvicorn app.main:app --reload
```
API docs: http://localhost:8000/docs
Dashboard: http://localhost:8000/

## Launch Control API
- `GET /api/launch` — current evidence-backed readiness brief
- `POST /api/agents/run` — run the reconciliation and prioritization workflow
- `GET /api/data` — imported file inventory, risk signals, and recent file changes
- `POST /api/data/import` — import the Soony portal ZIP as multipart field `file`
- `POST /api/data/sync` — read `/api/v1/files` and download only files whose SHA-256 changed
- `GET /api/supplier-draft?edition=Standard` — prepare a supplier email for review (`Collector's Edition` is also supported)

### Connect to the Soony portal
1. Register your team in the portal and copy the team token from Settings.
2. Put it in `backend/.env` as `SOONY_PORTAL_TOKEN`. Set `SOONY_PORTAL_URL` to the portal origin. The default auth is `Authorization: Bearer <token>`; if portal docs specify another header, set `SOONY_PORTAL_TOKEN_HEADER` and `SOONY_PORTAL_TOKEN_PREFIX` accordingly.
3. Restart the API and use **Sync portal** on the dashboard. Once configured, Linewatch also checks the lightweight file manifest every five minutes and downloads only files whose SHA-256 changed. Or download `GET /api/v1/archive.zip` in the portal and use **Import archive ZIP**.
4. After a new event/data drop appears, sync/import again. Linewatch compares file checksums against the previous archive and lists new, changed, and removed files.

Imports stay on the machine in the ignored `.local_data/` folder. Do not add Soony data to Git or share it outside the hackathon team. The dashboard does not require a database; the starter `GET /health` and `/items` endpoints still use Postgres.

## Try the risk workflow
1. Start the API and open `http://localhost:8000/`.
2. Without portal credentials, press **Run agents** to see the kickoff shortage analysis and supplier follow-up drafts.
3. Import a Soony ZIP from the portal. Review the detected files, rows, risks, and evidence.
4. Sync/import again after an event. The event list shows changed files; **Run agents** evaluates the latest snapshot.
5. Prepare an edition supplier draft and verify the recipient before copying/sending it yourself.

To demo changing data without a portal token, run `python scripts/create_demo_drops.py` from `backend/`. Import `.local_data/demo_drops/drop_1.zip`, review the stock and Taiwan-port signals, then import `drop_2.zip`. The second snapshot changes a PO confirmation/ETA and supplier IBAN; Linewatch should raise a critical bank-verification signal and show the changed fields. The supplier and data are fictional.

## Office-hours questions
- **Nils (IT):** Which files are authoritative for PO, goods receipt, and pack-out quantities? How do we recognize a replacement export versus a new event?
- **Felix (buyer):** Which component or supplier currently gates pack-out? What are the last truck and dock cutoffs for Hamburg?
- **Maren (procurement):** Which edition shortfall causes the greatest customer cost, what expedite spend is acceptable, and who must approve it?

Run the intake checks from `backend/`:
```powershell
python -m unittest discover -s tests -v
```

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
