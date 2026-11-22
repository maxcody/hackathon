"""Background job: let an agent analyze every newly received email once.

Runs inside the backend (started from ``app.main``'s lifespan) when
``MAIL_TRIAGE`` is on. Each cycle reads the inbox, and for each received email
without an analysis starts a fresh Codex session with the ``email-triage``
skill. The agent records its analysis via the notifications MCP tool.
"""

import asyncio
import logging

from app import mail_analysis
from app.codex_agent import CodexError, run_turn
from app.config import settings
from app.mail_analysis import MailAnalysis
from app.routers.inbox import MailMessage, mailbox

logger = logging.getLogger(__name__)


def build_prompt(message: MailMessage, original: MailMessage | None) -> str:
    """Instruction for one email, with the email and the mail it answers."""
    parts = [
        "Run the email-triage skill: call the skills tool get_skill with name "
        '"email-triage" now and follow every step for this received email.',
        f"Message-ID: {message.message_id}\nFrom: {message.sender}\n"
        f"To: {', '.join(message.to)}\nDate: {message.at}\n"
        f"Subject: {message.subject}\n\n{message.body}",
    ]
    if original:
        parts.append(
            "It replies to this email we sent:\n"
            f"To: {', '.join(original.to)}\nDate: {original.at}\n"
            f"Subject: {original.subject}\n\n{original.body}"
        )
    return "\n\n---\n\n".join(parts)


def triage_once() -> int:
    """Analyze every received email that has no analysis yet; return how many."""
    box = mailbox()
    done = mail_analysis.load()
    by_id = {m.message_id: m for m in box.messages}
    pending = [
        m
        for m in reversed(box.messages)  # oldest first
        if m.direction == "in"
        # "running" here means a previous run was interrupted (one cycle at a time)
        and (m.message_id not in done or done[m.message_id].status == "running")
    ]
    for message in pending:
        mail_analysis.save(
            MailAnalysis(message_id=message.message_id, status="running")
        )
        original = by_id.get(message.in_reply_to or "")
        try:
            reply, _ = run_turn(build_prompt(message, original), None)
        except CodexError as error:
            mail_analysis.save(
                MailAnalysis(
                    message_id=message.message_id, status="failed", error=str(error)
                )
            )
            continue
        stored = mail_analysis.load().get(message.message_id)
        if stored is None or stored.status != "done":  # agent did not record it
            mail_analysis.save(
                MailAnalysis(
                    message_id=message.message_id,
                    status="failed",
                    summary=reply[:2000],
                    error="The agent replied but did not record an analysis.",
                )
            )
    return len(pending)


async def triage_loop() -> None:
    """Check for new received email every ``MAIL_TRIAGE_INTERVAL_SECONDS``."""
    while True:
        try:
            count = await asyncio.to_thread(triage_once)
            if count:
                logger.info("Analyzed %d received email(s)", count)
        except Exception:  # keep the loop alive; the next cycle retries
            logger.exception("Email triage cycle failed")
        await asyncio.sleep(settings.mail_triage_interval_seconds)
