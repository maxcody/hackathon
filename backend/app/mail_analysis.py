"""Agent analyses of received emails, kept in ``.local_data/mail_analyses.json``.

The email-triage agent writes one analysis per received message (through the
notifications MCP tool and ``POST /inbox/analyses``); the inbox shows it next to
the mail. A small JSON file is enough: there are few emails and one writer.
"""

import json
import threading
from datetime import UTC, datetime
from typing import Literal

from pydantic import BaseModel

from app.mailer import BACKEND

STORE = BACKEND.parent / ".local_data" / "mail_analyses.json"
_lock = threading.Lock()


class Commitment(BaseModel):
    """Something the sender commits to or states as fact."""

    what: str
    quantity: str = ""
    date: str = ""
    price: str = ""


class MailAnalysis(BaseModel):
    """An agent's reading of one received email."""

    message_id: str
    status: Literal["running", "done", "failed"] = "done"
    updated_at: str = ""
    language: str = ""
    summary: str = ""
    translation: str = ""
    commitments: list[Commitment] = []
    risks: str = ""
    next_step: str = ""
    notification_keys: list[str] = []
    # What the supplier answered; "declined"/"partial" makes the agent draft plan B
    outcome: Literal["confirmed", "partial", "declined", "question", "other"] = "other"
    supplier_id: str = ""
    error: str | None = None


def load() -> dict[str, MailAnalysis]:
    """Return all analyses by message id."""
    with _lock:
        if not STORE.exists():
            return {}
        raw = json.loads(STORE.read_text(encoding="utf-8") or "{}")
    return {key: MailAnalysis(**value) for key, value in raw.items()}


def save(analysis: MailAnalysis) -> MailAnalysis:
    """Store (or replace) the analysis of one message."""
    analysis = analysis.model_copy(update={"updated_at": datetime.now(UTC).isoformat()})
    with _lock:
        raw = json.loads(STORE.read_text(encoding="utf-8")) if STORE.exists() else {}
        raw[analysis.message_id] = analysis.model_dump()
        STORE.parent.mkdir(parents=True, exist_ok=True)
        STORE.write_text(json.dumps(raw, ensure_ascii=False, indent=1), "utf-8")
    return analysis


def delete(message_id: str) -> bool:
    """Forget the analysis of one message so the next triage cycle redoes it."""
    with _lock:
        if not STORE.exists():
            return False
        raw = json.loads(STORE.read_text(encoding="utf-8"))
        found = raw.pop(message_id, None) is not None
        STORE.write_text(json.dumps(raw, ensure_ascii=False, indent=1), "utf-8")
    return found
