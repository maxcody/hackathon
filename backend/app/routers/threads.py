"""The email conversation behind each issue, and follow-ups sent from it.

A thread is built from what is already recorded, no extra mail store:

- emails sent from the issue: its sent solutions (``message_id``) and follow-ups
  (``data.followups``),
- replies to any of those (``In-Reply-To``), followed along the chain,
- received emails the triage agent linked to the issue (``notification_keys``).
"""

from datetime import UTC, datetime

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from sqlalchemy import select
from starlette.concurrency import run_in_threadpool

from app.codex_agent import CodexError, run_turn
from app.db import SessionDep
from app.email_drafting import DraftRequest, DraftResult, build_prompt, parse_draft
from app.mailer import MailError, deliver
from app.models import Notification
from app.routers.inbox import MailMessage, mailbox

router = APIRouter(prefix="/notifications", tags=["threads"])


class ThreadSummary(BaseModel):
    """Who spoke last in an issue's thread, for the issue list."""

    count: int
    last_direction: str  # "out": waiting for the supplier; "in": supplier answered
    last_at: str


class FollowUp(BaseModel):
    """A reply or follow-up written in the thread view."""

    to: list[str]
    cc: list[str] = []
    subject: str
    body: str
    # Set when writing to a conditional or unqualified supplier (PP-07)
    approved_by: str | None = None


def _sent_ids(data: dict) -> set[str]:
    """Message ids of the emails sent from an issue."""
    ids = {s.get("message_id") for s in data.get("solutions", [])}
    ids |= {f.get("message_id") for f in data.get("followups", [])}
    return {i for i in ids if i}


def thread_of(data: dict, messages: list[MailMessage]) -> list[MailMessage]:
    """The messages that belong to one issue, oldest first.

    Args:
        data: The notification's ``data`` (solutions, follow-ups, key).
        messages: The whole mailbox.
    """
    ids, key = _sent_ids(data), data.get("key")
    found: dict[str, MailMessage] = {}
    grew = True
    while grew:  # a reply to a reply belongs to the thread too
        grew = False
        for m in messages:
            linked = key and m.analysis and key in m.analysis.notification_keys
            if m.message_id in found or not (
                m.message_id in ids or m.in_reply_to in ids or linked
            ):
                continue
            # A mail sent to our own address is listed as sent and received: keep one
            found[m.message_id] = m
            ids.add(m.message_id)
            grew = True
    return sorted(found.values(), key=lambda m: m.at)


@router.get("/threads")
async def thread_summaries(session: SessionDep) -> dict[int, ThreadSummary]:
    """For every issue with emails: message count and who wrote last."""
    box = await run_in_threadpool(mailbox)
    summaries: dict[int, ThreadSummary] = {}
    for n in (await session.scalars(select(Notification))).all():
        thread = thread_of(n.data, box.messages)
        if thread:
            last = thread[-1]
            summaries[n.id] = ThreadSummary(
                count=len(thread), last_direction=last.direction, last_at=last.at
            )
    return summaries


@router.get("/{notification_id}/thread")
async def get_thread(
    notification_id: int, session: SessionDep, refresh: bool = False
) -> list[MailMessage]:
    """The emails of one issue, oldest first; ``refresh`` re-reads Gmail."""
    notification = await session.get(Notification, notification_id)
    if notification is None:
        raise HTTPException(404, "Issue not found.")
    box = await run_in_threadpool(mailbox, refresh)
    return thread_of(notification.data, box.messages)


@router.post("/{notification_id}/thread")
async def send_follow_up(
    notification_id: int, email: FollowUp, session: SessionDep
) -> list[MailMessage]:
    """Send a reply or follow-up and add it to the issue's thread."""
    notification = await session.get(Notification, notification_id)
    if notification is None:
        raise HTTPException(404, "Issue not found.")
    try:
        message_id = await run_in_threadpool(
            deliver, email.to, email.subject, email.body, email.cc
        )
    except MailError as error:
        raise HTTPException(502, f"Email not sent: {error}") from error
    followups = [
        *notification.data.get("followups", []),
        {
            "message_id": message_id,
            "sent_at": datetime.now(UTC).isoformat(),
            "to": email.to,
            "approved_by": email.approved_by,
        },
    ]
    notification.data = {**notification.data, "followups": followups}
    await session.commit()
    box = await run_in_threadpool(mailbox)
    return thread_of(notification.data, box.messages)


@router.post("/{notification_id}/thread/draft")
async def draft_email(
    notification_id: int, request: DraftRequest, session: SessionDep
) -> DraftResult:
    """Let the agent write the next email of the thread, or refine the current
    draft following ``feedback``. Nothing is sent."""
    notification = await session.get(Notification, notification_id)
    if notification is None:
        raise HTTPException(404, "Issue not found.")
    box = await run_in_threadpool(mailbox)
    thread = thread_of(notification.data, box.messages)
    prompt = await run_in_threadpool(build_prompt, notification.data, thread, request)
    try:
        reply, _ = await run_in_threadpool(run_turn, prompt, None)
        return parse_draft(reply, request.subject)
    except (CodexError, ValueError) as error:
        raise HTTPException(502, f"No draft: {error}") from error
