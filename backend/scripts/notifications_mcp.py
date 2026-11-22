"""MCP server that lets agents post findings to the dashboard as notifications.

Run it over stdio from an MCP client, e.g. in ``~/.codex/config.toml``::

    [mcp_servers.notifications]
    command = "<repo>/.venv/Scripts/python.exe"
    args = ["<repo>/backend/scripts/notifications_mcp.py"]

It talks to the running backend's ``/notifications`` CRUD endpoints
(``BACKEND_URL``, default ``http://localhost:8000``). The backend does not
deduplicate, so every finding carries a stable ``key`` in ``data``: reporting
the same key again updates that row instead of creating a new one.
"""

import os
import re
from datetime import UTC, datetime
from typing import Literal

import httpx
from mcp.server import MCPServer
from pydantic import BaseModel, Field

BACKEND_URL = os.environ.get("BACKEND_URL", "http://localhost:8000")


def make_client() -> httpx.AsyncClient:
    """Build a client for the backend API."""
    return httpx.AsyncClient(base_url=BACKEND_URL, timeout=30)


# Problem kinds; the key is "<kind>:<subject>" (see report_notification)
Kind = Literal[
    "receipt_mismatch",
    "po_confirmation",
    "stock_shortage",
    "quality",
    "shipment_delay",
    "supplier_notice",
    "master_data",
    "capacity",
    "policy",
]


def make_key(kind: str, subject: str) -> str:
    """Build the notification key, normalized so reruns hit the same row.

    Args:
        kind: The problem kind (see ``Kind``).
        subject: The affected object's id(s), e.g. ``4500318744:1``.

    Returns:
        ``<kind>:<SUBJECT>`` with whitespace removed and ids upper-cased.
    """
    parts = [re.sub(r"\s+", "", part).upper() for part in subject.split(":")]
    return ":".join([kind, *(part for part in parts if part)])


class Fact(BaseModel):
    """One key figure of the problem, shown big on the card."""

    label: str = Field(
        description="Short, e.g. 'In stock', 'Missing', 'Expected delivery'"
    )
    value: str = Field(description="The figure or date, e.g. '18,000' or 'Mon 23 Nov'")


class SolutionEmail(BaseModel):
    """A ready-to-send email that would solve (part of) the problem."""

    to: list[str]
    cc: list[str] = []
    subject: str
    body: str = Field(
        description="Full text: the supplier's preferred language first, then English"
    )
    translation: str = Field(
        "", description="English translation of the non-English part, for review"
    )


class Solution(BaseModel):
    """One proposed way to solve a problem."""

    kind: Literal["email", "internal", "decision", "claim"] = Field(
        description="email: a supplier email solves it; internal: someone at Soony "
        "acts; decision: management must choose; claim: complaint/credit request"
    )
    title: str = Field(description="Short action, e.g. 'Order 8,000 art books'")
    description: str = Field(description="What it achieves, why it works, impact")
    owner: str = Field("", description="Who acts, by name and role if known")
    deadline: str = Field("", description="Latest time it still helps the launch")
    cost: str = Field("", description="Estimated cost, e.g. 'EUR 16,800'")
    approval: str = Field(
        "",
        description="Who must approve before acting (per PP-07), e.g. "
        "'Category Lead (air freight)'; empty if no approval is needed",
    )
    email: SolutionEmail | None = Field(
        None, description="Required when kind is email or claim sent by email"
    )
    supplier_id: str = Field("", description="Supplier it goes to, e.g. SUP-0011")
    stage: Literal["now", "parallel", "if_declined"] = Field(
        "now",
        description="now: do it now; parallel: ask this backup supplier at the same "
        "time as the primary (critical, little time); if_declined: plan B, only "
        "if the supplier asked first cannot deliver",
    )


def merge_solutions(old: list[dict], new: list[Solution]) -> list[dict]:
    """Keep solutions already sent, then add the newly proposed ones.

    Args:
        old: The notification's current solutions.
        new: Solutions proposed in this run.

    Returns:
        Sent solutions unchanged, followed by new proposals not already sent.
    """
    sent = [s for s in old if s.get("status") == "sent"]
    titles = {s.get("title") for s in sent}
    fresh = [
        {**s.model_dump(), "status": "proposed"} for s in new if s.title not in titles
    ]
    return sent + fresh


async def find_by_key(client: httpx.AsyncClient, key: str) -> dict | None:
    """Return the notification whose ``data.key`` equals ``key``, if any."""
    response = await client.get("/notifications")
    response.raise_for_status()
    return next((n for n in response.json() if n["data"].get("key") == key), None)


server = MCPServer(
    "notifications",
    instructions=(
        "Post launch findings to the Linewatch dashboard. Each problem is "
        "identified by its kind and the affected object's id (subject); "
        "reporting the same kind and subject again updates the existing "
        "notification instead of creating a duplicate. Always cite source files "
        "in refs. Values are text."
    ),
)


@server.tool()
async def report_notification(
    kind: Kind,
    subject: str,
    attr: str,
    title: str,
    erp_val: str | None = None,
    customer_val: str | None = None,
    severity: str = "",
    details: str = "",
    refs: list[str] | None = None,
    solutions: list[Solution] | None = None,
    headline: str = "",
    facts: list[Fact] | None = None,
) -> str:
    """Create a notification, or update the one for the same kind and subject.

    One notification per problem: put everything about the same object into it.

    Args:
        kind: The problem kind.
        subject: The affected object's id(s), by kind:
            receipt_mismatch ``<delivery_note>:<material_id>``;
            po_confirmation ``<po_number>:<po_line>``;
            stock_shortage ``<material_id>``;
            quality ``<material_id>:<lot_or_batch>``;
            shipment_delay ``<shipment_id>``;
            supplier_notice ``<supplier_id>:<topic>`` (topic: shutdown, delay,
            capacity, export-licence, price, express-offer, bank-details,
            quality, other);
            master_data ``<component_id>:<change_id_or_field>``;
            capacity ``<product_id>:<site>``;
            policy ``<po_number_or_supplier_id>``.
        attr: What differs, e.g. ``quantity``.
        title: One-line headline for the dashboard.
        erp_val: The ERP's value, as text.
        customer_val: The customer side's (paper, supplier) value, as text.
        severity: ``critical``, ``warning`` or ``info``.
        details: Longer explanation, shown collapsed. Keep the card readable
            without it.
        refs: Only the files that contain the figures you report (not every file
            you read), as portal paths; the dashboard lists them as links.
        solutions: 1-3 concrete ways to solve it, best first. In each solution's
            description wrap the important facts (supplier, quantity, date, cost)
            in ``**double asterisks**`` so the dashboard highlights them. Email
            solutions carry a finished draft; the dashboard shows it in a popup
            with a Send button. Never send these emails yourself.
        headline: The problem in one plain sentence a manager understands at a
            glance, no ids or jargon, e.g. "Art books will not arrive on time".
        facts: 2-4 key figures, e.g. In stock, Missing, Expected delivery date.

    Returns:
        Whether a row was created or updated, with its id. A re-reported finding
        keeps its existing status, so a human's decision is not overwritten.
    """
    key = make_key(kind, subject)
    fields = {
        "key": key,
        "title": title,
        "kind": kind,
        "severity": severity,
        "details": details,
        "refs": refs or [],
    }
    # Re-reports that omit these (an email triage update) must not blank them
    if headline:
        fields["headline"] = headline
    if facts:
        fields["facts"] = [f.model_dump() for f in facts]
    proposed = solutions or []
    body = {"attr": attr, "erp_val": erp_val, "customer_val": customer_val}
    async with make_client() as client:
        existing = await find_by_key(client, key)
        if existing is None:
            body["data"] = {
                **fields,
                "status": "open",
                "solutions": merge_solutions([], proposed),
            }
            response = await client.post("/notifications", json=body)
            if response.status_code != 409:  # 409: a parallel run created it
                response.raise_for_status()
                return f"Created notification #{response.json()['id']} ({key})"
            existing = await find_by_key(client, key)
            if existing is None:
                response.raise_for_status()
        old = existing["data"].get("solutions", [])
        body["data"] = {
            **existing["data"],
            **fields,
            "solutions": merge_solutions(old, proposed),
        }
        body["seen_at"] = datetime.now(UTC).isoformat()
        response = await client.patch(f"/notifications/{existing['id']}", json=body)
        response.raise_for_status()
        return f"Updated notification #{existing['id']} ({key})"


class EmailCommitment(BaseModel):
    """Something the email's sender commits to or states as fact."""

    what: str = Field(description="e.g. 'Ships 8,000 art books by truck'")
    quantity: str = ""
    date: str = Field("", description="Date/time as stated, with timezone if given")
    price: str = ""


@server.tool()
async def record_email_analysis(
    message_id: str,
    summary: str,
    language: str = "",
    translation: str = "",
    commitments: list[EmailCommitment] | None = None,
    risks: str = "",
    next_step: str = "",
    notification_keys: list[str] | None = None,
    outcome: Literal["confirmed", "partial", "declined", "question", "other"] = "other",
    supplier_id: str = "",
) -> str:
    """Save your analysis of a received email; the dashboard inbox shows it.

    Args:
        message_id: The email's Message-ID exactly as given to you.
        summary: Two or three sentences in English: who writes, what they say.
        language: Language of the email, e.g. ``pl`` or ``en``.
        translation: Full English translation if the email is not in English.
        commitments: Concrete quantities, dates and prices the sender commits to.
        risks: What in the email threatens the launch, or contradicts our data.
        next_step: The one action a buyer should take now.
        notification_keys: Keys of the notifications this email relates to.
        outcome: What the supplier answered: confirmed (all we asked), partial
            (only part), declined (cannot), question (asks us something), other.
        supplier_id: The sender's supplier id from ``profile.csv``.

    Returns:
        Confirmation that the analysis was saved.
    """
    body = {
        "message_id": message_id,
        "status": "done",
        "summary": summary,
        "language": language,
        "translation": translation,
        "commitments": [c.model_dump() for c in commitments or []],
        "risks": risks,
        "next_step": next_step,
        "notification_keys": notification_keys or [],
        "outcome": outcome,
        "supplier_id": supplier_id,
    }
    async with make_client() as client:
        response = await client.post("/inbox/analyses", json=body)
        response.raise_for_status()
    return f"Saved analysis for {message_id}"


@server.tool()
async def list_notifications(status: str = "", kind: str = "") -> str:
    """List notifications, optionally filtered by status or kind.

    Args:
        status: Only this status, e.g. ``open`` or ``resolved``.
        kind: Only this kind, e.g. ``stock_mismatch``.

    Returns:
        One line per notification: id, key, status, attr, ERP vs customer, title.
    """
    async with make_client() as client:
        response = await client.get("/notifications")
        response.raise_for_status()
    rows = [
        n
        for n in response.json()
        if (not status or n["data"].get("status") == status)
        and (not kind or n["data"].get("kind") == kind)
    ]
    lines = [
        f"#{n['id']} [{n['data'].get('status', '')}] {n['data'].get('key', '')} "
        f"{n['attr']}: ERP {n['erp_val']} vs customer {n['customer_val']} "
        f"- {n['data'].get('title', '')}{supplier_line(n['data'])}"
        for n in rows
    ]
    return f"{len(rows)} notifications\n" + "\n".join(lines)


def supplier_line(data: dict) -> str:
    """The suppliers already contacted for an issue, e.g. " | suppliers: X declined"."""
    states = [
        f"{s.get('name') or s['supplier_id']} {s['state']}"
        + (f" {s['quantity']}" if s.get("quantity") else "")
        for s in data.get("suppliers", [])
    ]
    return f" | suppliers: {', '.join(states)}" if states else ""


def set_supplier(data: dict, entry: dict) -> dict:
    """Return ``data`` with one supplier's entry in ``data.suppliers`` replaced."""
    others = [
        s for s in data.get("suppliers", []) if s["supplier_id"] != entry["supplier_id"]
    ]
    return {**data, "suppliers": [*others, entry]}


@server.tool()
async def set_supplier_state(
    key: str,
    supplier_id: str,
    name: str,
    state: Literal["asked", "confirmed", "partial", "declined", "no_answer"],
    quantity: str = "",
    note: str = "",
) -> str:
    """Record where a supplier stands on an issue (shown as a chain on the card).

    Call it when a supplier is asked, and when it confirms, delivers only part,
    declines or does not answer in time. Never propose a declined supplier again.

    Args:
        key: The notification's key.
        supplier_id: e.g. ``SUP-0010``.
        name: Supplier name, e.g. ``Hwaseong Memory``.
        state: asked, confirmed, partial, declined or no_answer.
        quantity: What it confirmed or can deliver, e.g. ``4,000 by 18:00``.
        note: One short sentence, e.g. "capacity booked until December".

    Returns:
        A confirmation, or a message if no notification has that key.
    """
    entry = {
        "supplier_id": supplier_id,
        "name": name,
        "state": state,
        "quantity": quantity,
        "note": note,
        "at": datetime.now(UTC).isoformat(),
    }
    async with make_client() as client:
        existing = await find_by_key(client, key)
        if existing is None:
            return f"No notification with key {key}"
        data = set_supplier(existing["data"], entry)
        response = await client.patch(
            f"/notifications/{existing['id']}", json={"data": data}
        )
        response.raise_for_status()
    return f"#{existing['id']}: {name} is {state}"


def format_sources(sources: list[dict]) -> str:
    """One line per supplier option for the agent."""
    lines = []
    for s in sources:
        facts = [
            f"share {s['share']:.0%}" if s.get("share") is not None else "",
            (
                f"{s['unit_price']} {s['currency']}"
                if s.get("unit_price") is not None
                else ""
            ),
            (
                f"lead {s['lead_time_days']} d"
                if s.get("lead_time_days") is not None
                else ""
            ),
            f"MOQ {s['moq']}" if s.get("moq") is not None else "",
            "NEEDS PP-07 APPROVAL" if s["needs_approval"] else "",
        ]
        lines.append(
            f"{s['role']}: {s['supplier_id']} {s['name']} <{s['contact_email']}> "
            f"lang {s['preferred_language']}, {s['qualification_status']}; "
            + ", ".join(f for f in facts if f)
            + (f"; note: {s['note']}" if s.get("note") else "")
            + (f"; notices: {', '.join(s['notices'])}" if s.get("notices") else "")
        )
    return "\n".join(lines)


@server.tool()
async def sourcing_options(component_id: str) -> str:
    """Who can supply a part, best first: primary, second sources, same category.

    Use it before proposing solutions for a shortage, and when a supplier
    declines, to find the next one to ask.

    Args:
        component_id: e.g. ``CMP-GAM-001``.

    Returns:
        One line per supplier: role, contact, share, price, lead time, MOQ,
        whether PP-07 approval is needed, and its notices (offers, price lists).
    """
    async with make_client() as client:
        response = await client.get(f"/sourcing/{component_id}")
        response.raise_for_status()
    sources = response.json()
    return format_sources(sources) if sources else f"No supplier lists {component_id}."


@server.tool()
async def set_notification_status(key: str, status: str, note: str = "") -> str:
    """Change a notification's status, e.g. to ``resolved`` or ``in_progress``.

    Args:
        key: The notification's key.
        status: New status.
        note: Optional reason, stored as ``status_note``.

    Returns:
        A confirmation, or a message if no notification has that key.
    """
    async with make_client() as client:
        existing = await find_by_key(client, key)
        if existing is None:
            return f"No notification with key {key}"
        data = {**existing["data"], "status": status, "status_note": note}
        response = await client.patch(
            f"/notifications/{existing['id']}", json={"data": data}
        )
        response.raise_for_status()
    return f"Notification #{existing['id']} ({key}) is now {status}"


if __name__ == "__main__":
    server.run()
