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
from datetime import UTC, datetime

import httpx
from mcp.server import MCPServer

BACKEND_URL = os.environ.get("BACKEND_URL", "http://localhost:8000")


def make_client() -> httpx.AsyncClient:
    """Build a client for the backend API."""
    return httpx.AsyncClient(base_url=BACKEND_URL, timeout=30)


async def find_by_key(client: httpx.AsyncClient, key: str) -> dict | None:
    """Return the notification whose ``data.key`` equals ``key``, if any."""
    response = await client.get("/notifications")
    response.raise_for_status()
    return next((n for n in response.json() if n["data"].get("key") == key), None)


server = MCPServer(
    "notifications",
    instructions=(
        "Post launch findings to the Linewatch dashboard. Use one stable key per "
        "problem (e.g. 'stock:CMP-GAM-008:WZ-261116-473') so re-reporting updates "
        "it. Always cite source files in refs. Values are text."
    ),
)


@server.tool()
async def report_notification(
    key: str,
    attr: str,
    title: str,
    erp_val: str | None = None,
    customer_val: str | None = None,
    kind: str = "",
    severity: str = "",
    details: str = "",
    refs: list[str] | None = None,
) -> str:
    """Create a notification, or update the one with the same key.

    Args:
        key: Stable id for this problem, reused when it is detected again.
        attr: What differs, e.g. ``quantity``.
        title: One-line headline for the dashboard.
        erp_val: The ERP's value, as text.
        customer_val: The customer side's (paper, supplier) value, as text.
        kind: Category, e.g. ``stock_mismatch`` or ``short_shipment``.
        severity: ``critical``, ``warning`` or ``info``.
        details: Explanation and recommended action.
        refs: Source file paths backing the finding.

    Returns:
        Whether a row was created or updated, with its id. A re-reported finding
        keeps its existing status, so a human's decision is not overwritten.
    """
    fields = {
        "key": key,
        "title": title,
        "kind": kind,
        "severity": severity,
        "details": details,
        "refs": refs or [],
    }
    body = {"attr": attr, "erp_val": erp_val, "customer_val": customer_val}
    async with make_client() as client:
        existing = await find_by_key(client, key)
        if existing is None:
            body["data"] = {**fields, "status": "open"}
            response = await client.post("/notifications", json=body)
            response.raise_for_status()
            return f"Created notification #{response.json()['id']} ({key})"
        body["data"] = {**existing["data"], **fields}
        body["seen_at"] = datetime.now(UTC).isoformat()
        response = await client.patch(f"/notifications/{existing['id']}", json=body)
        response.raise_for_status()
        return f"Updated notification #{existing['id']} ({key})"


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
        f"- {n['data'].get('title', '')}"
        for n in rows
    ]
    return f"{len(rows)} notifications\n" + "\n".join(lines)


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
