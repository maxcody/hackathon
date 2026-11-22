"""Mailbox view for the dashboard: sent emails with their Brevo delivery status."""

import json

import httpx
from fastapi import APIRouter
from pydantic import BaseModel
from starlette.concurrency import run_in_threadpool

from app.mailer import SENT_LOG, EmailSettings

router = APIRouter(prefix="/inbox", tags=["inbox"])

# Later events win; an error outranks everything that came before it
STATUS_ORDER = ["requests", "deferred", "delivered", "opened", "clicks"]
ERRORS = {"softBounces", "hardBounces", "blocked", "invalid", "error", "spam"}


class MailMessage(BaseModel):
    """One email in the mailbox."""

    direction: str  # "out" (sent by us) or "in" (received)
    message_id: str
    at: str
    sender: str
    to: list[str]
    cc: list[str] = []
    subject: str
    body: str
    status: str | None = None  # Brevo delivery status for outgoing mail
    status_at: str | None = None


class Mailbox(BaseModel):
    """Everything the inbox tab shows."""

    messages: list[MailMessage]
    sender: str | None
    status_source: str | None  # "brevo" when delivery statuses are available
    incoming_configured: bool


def _sent() -> list[dict]:
    """Read the audit log of sent emails, newest first."""
    if not SENT_LOG.exists():
        return []
    lines = SENT_LOG.read_text(encoding="utf-8").splitlines()
    return [json.loads(line) for line in reversed(lines) if line.strip()]


def _brevo_status(settings: EmailSettings) -> dict[str, tuple[str, str]]:
    """Return the latest delivery status per Brevo message id (last 30 days)."""
    response = httpx.get(
        "https://api.brevo.com/v3/smtp/statistics/events",
        params={"limit": 2500, "days": 30, "sort": "asc"},
        headers={"api-key": settings.brevo_api_key},
        timeout=30,
    )
    response.raise_for_status()
    status: dict[str, tuple[str, str]] = {}
    for event in response.json().get("events", []):
        message_id, kind = event.get("messageId"), event.get("event", "")
        current = status.get(message_id, ("", ""))[0]
        if current in ERRORS:
            continue
        rank = STATUS_ORDER.index(kind) if kind in STATUS_ORDER else len(STATUS_ORDER)
        old = STATUS_ORDER.index(current) if current in STATUS_ORDER else -1
        if kind in ERRORS or rank >= old:
            status[message_id] = (kind, event.get("date", ""))
    return status


def mailbox() -> Mailbox:
    """Collect sent mail and, if Brevo is configured, its delivery status."""
    settings = EmailSettings()
    statuses: dict[str, tuple[str, str]] = {}
    source = None
    if settings.brevo_api_key:
        try:
            statuses, source = _brevo_status(settings), "brevo"
        except httpx.HTTPError:
            source = None  # show the mail without statuses rather than fail
    messages = [
        MailMessage(
            direction="out",
            message_id=entry["message_id"],
            at=entry["sent_at"],
            sender=settings.smtp_user or "",
            to=entry.get("to", []),
            cc=entry.get("cc", []),
            subject=entry.get("subject", ""),
            body=entry.get("body", ""),
            status=statuses.get(entry["message_id"], (None, None))[0],
            status_at=statuses.get(entry["message_id"], (None, None))[1],
        )
        for entry in _sent()
    ]
    return Mailbox(
        messages=messages,
        sender=settings.smtp_user,
        status_source=source,
        incoming_configured=False,
    )


@router.get("")
async def get_inbox() -> Mailbox:
    """Sent emails with delivery status (incoming mail is not connected yet)."""
    return await run_in_threadpool(mailbox)
