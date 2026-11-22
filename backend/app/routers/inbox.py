"""Mailbox view for the dashboard: sent mail with Brevo delivery status, and
received mail from the team Gmail via the Apps Script in ``scripts/gmail_inbox.gs``.
"""

import json

import httpx
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from starlette.concurrency import run_in_threadpool

from app import mail_analysis
from app.mail_analysis import MailAnalysis
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
    in_reply_to: str | None = None  # for received mail: the sent mail it answers
    analysis: MailAnalysis | None = None  # agent analysis of received mail


class Mailbox(BaseModel):
    """Everything the inbox tab shows."""

    messages: list[MailMessage]
    sender: str | None
    status_source: str | None  # "brevo" when delivery statuses are available
    incoming_configured: bool
    incoming_error: str | None = None


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


def _received(settings: EmailSettings) -> list[MailMessage]:
    """Fetch received mail from the Apps Script web app (last 14 days)."""
    response = httpx.get(
        settings.gmail_script_url,
        params={"token": settings.gmail_script_token, "days": 14},
        follow_redirects=True,  # Apps Script answers via a googleusercontent redirect
        timeout=30,
    )
    response.raise_for_status()
    payload = response.json()
    if "error" in payload:
        raise ValueError(payload["error"])
    return [MailMessage(direction="in", **message) for message in payload["messages"]]


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
    configured = bool(settings.gmail_script_url and settings.gmail_script_token)
    incoming_error = None
    if configured:
        try:
            messages += _received(settings)
        except (httpx.HTTPError, ValueError, KeyError, TypeError) as error:
            incoming_error = f"Could not read the Gmail inbox: {error}"
    messages.sort(key=lambda m: m.at, reverse=True)
    analyses = mail_analysis.load()
    for message in messages:
        message.analysis = analyses.get(message.message_id)
    return Mailbox(
        messages=messages,
        sender=settings.smtp_user,
        status_source=source,
        incoming_configured=configured,
        incoming_error=incoming_error,
    )


@router.post("/analyses", status_code=201)
async def record_analysis(analysis: MailAnalysis) -> MailAnalysis:
    """Store an agent's analysis of a received email (called by the MCP tool)."""
    return await run_in_threadpool(mail_analysis.save, analysis)


@router.delete("/analyses", status_code=204)
async def reanalyze(message_id: str) -> None:
    """Drop a message's analysis; the triage job analyzes it again next cycle."""
    if not await run_in_threadpool(mail_analysis.delete, message_id):
        raise HTTPException(404, "No analysis for this message.")


@router.get("")
async def get_inbox() -> Mailbox:
    """Sent mail with delivery status, plus received mail when Gmail is connected."""
    return await run_in_threadpool(mailbox)
