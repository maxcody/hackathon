"""Let an agent write or refine a supplier email for an issue's conversation.

The prompt carries everything the agent needs (the issue, the thread so far, the
supplier's language and the current draft with the user's feedback), and the
agent answers with one ``email-draft`` JSON block that :func:`parse_draft` reads.
"""

import json
import re

from pydantic import BaseModel

from app.routers.inbox import MailMessage
from app.sourcing import supplier_folders

SIGNATURE = "Soony Interactive GmbH, Procurement"
# Last emails of the thread given to the agent; older ones rarely change a reply
THREAD_LIMIT = 6


class DraftRequest(BaseModel):
    """What to draft: for whom, and optionally the current draft plus feedback."""

    to: str = ""
    subject: str = ""
    body: str = ""
    feedback: str = ""  # empty: write a fresh draft


class DraftResult(BaseModel):
    """A draft the composer can show."""

    subject: str
    body: str


def supplier_for(address: str) -> dict[str, str]:
    """Return the supplier profile whose contact email is ``address`` (or empty)."""
    wanted = address.strip().lower()
    for folder in supplier_folders():
        if folder.profile.get("contact_email", "").strip().lower() == wanted:
            return folder.profile
    return {}


def _issue_text(data: dict) -> str:
    """The issue as the agent should read it: headline, figures and solutions."""
    lines = [f"Issue: {data.get('headline') or data.get('title', '')}"]
    if data.get("details"):
        lines.append(f"Details: {data['details']}")
    for fact in data.get("facts", []) or []:
        lines.append(f"- {fact.get('label')}: {fact.get('value')}")
    for solution in data.get("solutions", []) or []:
        lines.append(
            f"Proposed solution: {solution.get('title', '')}: "
            f"{solution.get('description', '')}"
        )
    return "\n".join(lines)


def _thread_text(messages: list[MailMessage]) -> str:
    """The latest emails of the thread, oldest first."""
    if not messages:
        return "No emails have been exchanged for this issue yet."
    parts = []
    for m in messages[-THREAD_LIMIT:]:
        who = "We wrote" if m.direction == "out" else f"{m.sender} wrote"
        parts.append(
            f"--- {who} on {m.at}\nSubject: {m.subject}\n{m.body.strip()[:4000]}"
        )
    return "\n\n".join(parts)


def build_prompt(data: dict, thread: list[MailMessage], request: DraftRequest) -> str:
    """Build the agent prompt for a new draft or for refining ``request``'s draft.

    Args:
        data: The issue's notification data.
        thread: The issue's emails, oldest first.
        request: Recipient, and the current draft plus feedback when refining.
    """
    supplier = supplier_for(request.to)
    language = supplier.get("preferred_language", "")
    who = supplier.get("name") or request.to or "the supplier"
    contact = supplier.get("contact_name", "")
    task = (
        "Rewrite the current draft below following the feedback. Change only what "
        "the feedback asks for and keep every fact that is still right."
        if request.feedback and request.body.strip()
        else "Write the next email we should send in this conversation: reply to the "
        "supplier's latest email if there is one, otherwise follow up or make the "
        "request the issue needs."
    )
    sections = [
        "You write supplier emails for Soony's procurement team for the Grand Heist 6 "
        "launch (cutoff 20:00 CET on 22 November, delivery to DC-HAM, "
        "Dradenaustraße 12, 21129 Hamburg).",
        task,
        f"Recipient: {who} <{request.to}>"
        + (f", contact person {contact}" if contact else "")
        + (
            f". Write first in their preferred language ({language}), then the same "
            "text in English."
            if language and language.lower() not in ("en", "english")
            else ". Write in English."
        ),
        "Style: a real business email, not one block. Greeting with the contact's "
        "first name; a short paragraph on the situation with PO, part and quantity; "
        "requests as a numbered list when there is more than one; the deadline and "
        "why it matters; ask for written confirmation; then 'Thank you,' and "
        f"'{SIGNATURE}' on their own lines. Blank lines between paragraphs. Use only "
        "facts given here; do not invent numbers.",
        _issue_text(data),
        "Conversation so far:\n" + _thread_text(thread),
    ]
    if request.feedback and request.body.strip():
        sections += [
            f"Current draft:\nSubject: {request.subject}\n{request.body}",
            f"Feedback from the user: {request.feedback}",
        ]
    elif request.feedback:
        # A fresh draft with a brief, e.g. the analysis' recommended next step
        sections.append(f"What this email must achieve: {request.feedback}")
    sections.append(
        'Answer with only one fenced block: ```email-draft\n{"subject": "...", '
        '"body": "..."}\n``` (JSON, newlines in the body as \\n). Do not send it.'
    )
    return "\n\n".join(sections)


_BLOCK = re.compile(r"```(?:email-draft|json)?\s*(\{.*?\})\s*```", re.DOTALL)


def parse_draft(reply: str, fallback_subject: str = "") -> DraftResult:
    """Read the agent's ``email-draft`` block.

    Raises:
        ValueError: If the reply holds no usable draft.
    """
    match = _BLOCK.search(reply)
    raw = match.group(1) if match else reply[reply.find("{") : reply.rfind("}") + 1]
    try:
        value = json.loads(raw)
    except json.JSONDecodeError as error:
        raise ValueError("The agent did not return a draft.") from error
    body = str(value.get("body", "")).strip()
    if not body:
        raise ValueError("The agent returned an empty draft.")
    subject = str(value.get("subject", "")).strip() or fallback_subject
    return DraftResult(subject=subject, body=body)
