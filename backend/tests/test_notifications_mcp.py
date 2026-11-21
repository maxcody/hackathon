"""Tests for the notifications MCP server against a fake backend."""

import json

import httpx
import pytest

from scripts import notifications_mcp as tool


@pytest.fixture
def backend(monkeypatch: pytest.MonkeyPatch) -> list[dict]:
    """Serve /notifications from an in-memory list and route the tool to it."""
    rows: list[dict] = []

    def handle(request: httpx.Request) -> httpx.Response:
        if request.method == "GET":
            return httpx.Response(200, json=rows)
        body = json.loads(request.content)
        if request.method == "POST":
            row = {"id": len(rows) + 1, "seen_at": "t0", **body}
            rows.append(row)
            return httpx.Response(201, json=row)
        row = rows[int(request.url.path.rsplit("/", 1)[1]) - 1]
        row.update(body)  # PATCH replaces each sent field, data included
        return httpx.Response(200, json=row)

    def client() -> httpx.AsyncClient:
        transport = httpx.MockTransport(handle)
        return httpx.AsyncClient(transport=transport, base_url="http://test")

    monkeypatch.setattr(tool, "make_client", client)
    return rows


async def test_same_key_updates_instead_of_duplicating(backend: list[dict]) -> None:
    first = await tool.report_notification(
        key="stock:CMP-GAM-008", attr="quantity", title="Art books", erp_val="80000"
    )
    await tool.set_notification_status("stock:CMP-GAM-008", "in_progress")
    second = await tool.report_notification(
        key="stock:CMP-GAM-008",
        attr="quantity",
        title="Art books",
        erp_val="80000",
        customer_val="8000",
    )
    assert first.startswith("Created notification #1")
    assert second.startswith("Updated notification #1")
    assert len(backend) == 1
    assert backend[0]["customer_val"] == "8000"
    assert backend[0]["data"]["status"] == "in_progress"  # human decision kept


async def test_list_filters_by_status(backend: list[dict]) -> None:
    await tool.report_notification(key="a", attr="quantity", title="A")
    await tool.report_notification(key="b", attr="quantity", title="B")
    await tool.set_notification_status("b", "resolved")
    listing = await tool.list_notifications(status="open")
    assert listing.startswith("1 notifications") and " a " in listing


async def test_status_of_unknown_key(backend: list[dict]) -> None:
    assert await tool.set_notification_status("nope", "resolved") == (
        "No notification with key nope"
    )
