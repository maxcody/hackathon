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
            if any(r["data"]["key"] == body["data"]["key"] for r in rows):
                return httpx.Response(409, json={"detail": "duplicate"})
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


def test_key_is_normalized() -> None:
    assert tool.make_key("po_confirmation", " 4500318744 : 1 ") == (
        "po_confirmation:4500318744:1"
    )
    assert tool.make_key("receipt_mismatch", "wz-261116-473:cmp-gam-008") == (
        "receipt_mismatch:WZ-261116-473:CMP-GAM-008"
    )


async def test_same_problem_updates_instead_of_duplicating(
    backend: list[dict],
) -> None:
    first = await tool.report_notification(
        kind="stock_shortage", subject="CMP-GAM-008", attr="quantity", title="A"
    )
    key = "stock_shortage:CMP-GAM-008"
    await tool.set_notification_status(key, "in_progress")
    second = await tool.report_notification(
        kind="stock_shortage",
        subject=" cmp-gam-008 ",  # same object, written differently
        attr="quantity",
        title="Art books",
        customer_val="8000",
    )
    assert first.startswith("Created notification #1")
    assert second.startswith("Updated notification #1")
    assert len(backend) == 1
    assert backend[0]["customer_val"] == "8000"
    assert backend[0]["data"]["status"] == "in_progress"  # human decision kept


async def test_parallel_create_falls_back_to_update(
    backend: list[dict], monkeypatch: pytest.MonkeyPatch
) -> None:
    await tool.report_notification(
        kind="shipment_delay", subject="SHP-1", attr="eta", title="Late"
    )
    real_find = tool.find_by_key
    calls = {"n": 0}

    async def stale_find(client: httpx.AsyncClient, key: str) -> dict | None:
        calls["n"] += 1
        return None if calls["n"] == 1 else await real_find(client, key)

    monkeypatch.setattr(tool, "find_by_key", stale_find)  # other run won the race
    reply = await tool.report_notification(
        kind="shipment_delay", subject="SHP-1", attr="eta", title="Later"
    )
    assert reply.startswith("Updated notification #1")
    assert len(backend) == 1 and backend[0]["data"]["title"] == "Later"


async def test_list_filters_by_status(backend: list[dict]) -> None:
    await tool.report_notification(kind="policy", subject="a", attr="x", title="A")
    await tool.report_notification(kind="policy", subject="b", attr="x", title="B")
    await tool.set_notification_status("policy:B", "resolved")
    listing = await tool.list_notifications(status="open")
    assert listing.startswith("1 notifications") and "policy:A" in listing


async def test_status_of_unknown_key(backend: list[dict]) -> None:
    assert await tool.set_notification_status("nope", "resolved") == (
        "No notification with key nope"
    )


async def test_headline_and_facts_are_kept_when_a_later_report_omits_them(
    backend: list[dict],
) -> None:
    await tool.report_notification(
        kind="shipment_delay",
        subject="SHP-1",
        attr="eta",
        title="Late",
        headline="Art books will not arrive on time",
        facts=[
            tool.Fact(label="In stock", value="18,000"),
            tool.Fact(label="Missing", value="62,000"),
        ],
        refs=["soony/erp/stock_snapshot.csv"],
    )
    data = backend[0]["data"]
    assert data["headline"] == "Art books will not arrive on time"
    assert data["facts"] == [
        {"label": "In stock", "value": "18,000"},
        {"label": "Missing", "value": "62,000"},
    ]

    # An email-triage style update that only adds details must not blank them
    await tool.report_notification(
        kind="shipment_delay",
        subject="SHP-1",
        attr="eta",
        title="Late",
        details="Supplier confirmed a truck.",
    )
    data = backend[0]["data"]
    assert data["headline"] == "Art books will not arrive on time"
    assert [f["label"] for f in data["facts"]] == ["In stock", "Missing"]
    assert data["details"] == "Supplier confirmed a truck."

    # A new headline replaces the old one
    await tool.report_notification(
        kind="shipment_delay",
        subject="SHP-1",
        attr="eta",
        title="Late",
        headline="Art books arrive a day late",
    )
    assert backend[0]["data"]["headline"] == "Art books arrive a day late"


async def test_supplier_states_show_in_the_listing(backend: list[dict]) -> None:
    await tool.report_notification(
        kind="stock_shortage", subject="CMP-1", attr="qty", title="Short"
    )
    await tool.set_supplier_state(
        "stock_shortage:CMP-1", "SUP-1", "Alpha", "asked", note="first ask"
    )
    await tool.set_supplier_state(
        "stock_shortage:CMP-1", "SUP-1", "Alpha", "declined", note="no capacity"
    )
    await tool.set_supplier_state("stock_shortage:CMP-1", "SUP-2", "Beta", "asked")
    suppliers = backend[0]["data"]["suppliers"]
    assert [(s["name"], s["state"]) for s in suppliers] == [
        ("Alpha", "declined"),
        ("Beta", "asked"),
    ]
    listing = await tool.list_notifications()
    assert "suppliers: Alpha declined, Beta asked" in listing


def test_backup_solutions_carry_supplier_and_stage() -> None:
    plan_b = tool.Solution(
        kind="email",
        title="Ask Beta",
        description="d",
        supplier_id="SUP-2",
        stage="if_declined",
    )
    merged = tool.merge_solutions([], [plan_b])
    assert merged[0]["stage"] == "if_declined" and merged[0]["supplier_id"] == "SUP-2"


def test_sources_are_listed_one_per_line() -> None:
    text = tool.format_sources(
        [
            {
                "role": "second_source",
                "supplier_id": "SUP-2",
                "name": "Beta",
                "contact_email": "b@sup.test",
                "preferred_language": "en",
                "qualification_status": "conditional",
                "share": 0.3,
                "unit_price": 10.2,
                "currency": "USD",
                "lead_time_days": 28,
                "moq": None,
                "needs_approval": True,
                "note": "",
                "notices": ["suppliers/SUP-2_Beta/notices/offer.pdf"],
            }
        ]
    )
    assert "share 30%" in text and "NEEDS PP-07 APPROVAL" in text
    assert "notices: suppliers/SUP-2_Beta/notices/offer.pdf" in text
